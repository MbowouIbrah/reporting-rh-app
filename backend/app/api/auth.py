import logging
from datetime import UTC, datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Path, Response
from pydantic import BaseModel, ConfigDict, Field, StringConstraints
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import mail
from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.models.auth import AuditEvent, PreferenceUtilisateur, Utilisateur
from app.security import audit
from app.security.deps import current_principal, session_principal, to_principal
from app.security.passwords import check_password, hash_password, verify_password
from app.security.policy import ACTIONS, Principal, is_allowed
from app.security.tokens import empreinte, make_token, read_claims

log = logging.getLogger(__name__)
router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE_AUTH_PATH = f"{settings.COOKIE_PATH_PREFIX}{settings.API_PREFIX}/auth"

# Hash factice : la durée de vérification ne révèle pas si l'e-mail existe.
_DUMMY_HASH = hash_password("dummy-password")


class LoginIn(BaseModel):
    email: str
    password: str
    remember: bool = False


class OubliIn(BaseModel):
    email: str


class ReinitIn(BaseModel):
    jeton: str
    password: str


class ChangementIn(BaseModel):
    actuel: str
    nouveau: str


def _set_cookies(response: Response, user: Utilisateur, remember: bool) -> None:
    """Cookies de session (sans max_age) si remember est faux."""
    opts = {"httponly": True, "secure": settings.COOKIE_SECURE, "samesite": "strict"}
    response.set_cookie(
        "access_token",
        make_token(user.id, "access", pwd=empreinte(user.password_hash)),
        max_age=settings.ACCESS_TOKEN_MINUTES * 60 if remember else None,
        path="/",
        **opts,
    )
    response.set_cookie(
        "refresh_token",
        make_token(user.id, "refresh", rem=remember, pwd=empreinte(user.password_hash)),
        max_age=settings.REFRESH_TOKEN_DAYS * 86400 if remember else None,
        path=COOKIE_AUTH_PATH,
        **opts,
    )


def _me(p: Principal) -> dict:
    return {
        "id": p.user_id,
        "email": p.email,
        "nom": p.nom,
        "fonction": p.fonction,
        "permissions": sorted(a for a in ACTIONS if is_allowed(p, a)),
        "doit_changer_mdp": p.doit_changer_mdp,
    }


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> dict:
    user = db.scalar(select(Utilisateur).where(Utilisateur.email == body.email.strip().lower()))
    ok = verify_password(body.password, user.password_hash if user else _DUMMY_HASH)
    if not (user and ok and user.actif):
        audit.record(db, user.id if user else None, "login_echec", "utilisateur", user and user.id)
        db.commit()
        raise HTTPException(status_code=401, detail="Identifiants invalides")
    audit.record(db, user.id, "login", "utilisateur", user.id)
    db.commit()
    _set_cookies(response, user, body.remember)
    return _me(to_principal(user))


@router.post("/refresh")
def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> dict:
    claims = read_claims(refresh_token, "refresh") if refresh_token else None
    uid = int(claims["sub"]) if claims and str(claims.get("sub", "")).isdigit() else None
    user = db.get(Utilisateur, uid) if uid else None
    if (
        user is None
        or not user.actif
        or claims.get("pwd") != empreinte(user.password_hash)
    ):
        raise HTTPException(status_code=401, detail="Session expirée")
    _set_cookies(response, user, bool(claims.get("rem")))
    return {"status": "ok"}


def _envoyer(dest: str, sujet: str, texte: str) -> None:
    try:
        mail.envoyer(dest, sujet, texte)
    except Exception:
        log.exception("Envoi de l'e-mail de réinitialisation impossible")


@router.post("/mot-de-passe-oublie")
def mot_de_passe_oublie(body: OubliIn, taches: BackgroundTasks) -> dict:
    """Réponse immédiate et identique que le compte existe ou non : tout se fait après."""
    taches.add_task(_traiter_oubli, body.email.strip().lower())
    return {"status": "ok"}


def _traiter_oubli(email: str) -> None:
    with SessionLocal() as db:
        # Verrou sur le compte : deux demandes simultanées ne donnent qu'un envoi.
        user = db.scalar(select(Utilisateur).where(Utilisateur.email == email).with_for_update())
        if user is None or not user.actif:
            return
        depuis = datetime.now(UTC) - timedelta(minutes=5)
        recent = db.scalar(
            select(AuditEvent.id)
            .where(
                AuditEvent.action == "reinit_demande",
                AuditEvent.entite_id == str(user.id),
                AuditEvent.ts >= depuis,
            )
            .limit(1)
        )
        if recent is not None:
            return
        jeton = make_token(user.id, "reset", pwd=empreinte(user.password_hash))
        # Fragment (#) : le jeton n'est jamais envoyé au serveur, donc absent des journaux d'accès.
        lien = f"{settings.APP_URL.rstrip('/')}/reinitialiser#jeton={jeton}"
        texte = (
            "Bonjour,\n\nPour choisir un nouveau mot de passe, ouvrez ce lien "
            f"(valable {settings.RESET_TOKEN_MINUTES} minutes, usage unique) :\n{lien}\n\n"
            "Si vous n'êtes pas à l'origine de cette demande, ignorez ce message."
        )
        audit.record(db, user.id, "reinit_demande", "utilisateur", user.id)
        if not settings.SMTP_HOST:
            if settings.ENV != "prod":
                log.warning("Lien de réinitialisation pour %s : %s", user.email, lien)
            audit.record(db, user.id, "reinit_non_envoye", "utilisateur", user.id)
        db.commit()
        if settings.SMTP_HOST:
            _envoyer(user.email, f"{settings.APP_NAME} : réinitialisation du mot de passe", texte)


@router.post("/reinitialiser")
def reinitialiser(body: ReinitIn, db: Session = Depends(get_db)) -> dict:
    claims = read_claims(body.jeton, "reset")
    uid = int(claims["sub"]) if claims and str(claims.get("sub", "")).isdigit() else None
    user = db.get(Utilisateur, uid) if uid else None
    if user is None or not user.actif or claims.get("pwd") != empreinte(user.password_hash):
        raise HTTPException(status_code=400, detail="Lien invalide ou expiré")
    check_password(body.password)
    if verify_password(body.password, user.password_hash):
        audit.record(db, user.id, "reinit_mdp_refuse", "utilisateur", user.id)
        db.commit()
        raise HTTPException(422, "Le nouveau mot de passe doit être différent de l'actuel")
    user.password_hash = hash_password(body.password)
    user.doit_changer_mdp = False
    audit.record(db, user.id, "reinit_mdp", "utilisateur", user.id)
    db.commit()
    return {"status": "ok"}


@router.post("/changer-mot-de-passe")
def changer_mot_de_passe(
    body: ChangementIn,
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    principal: Principal = Depends(session_principal),
    db: Session = Depends(get_db),
) -> dict:
    """Le nouveau hachage ferme les autres sessions ; celle-ci reçoit de nouveaux cookies.
    Mot de passe actuel faux : 400 et non 401, la session reste valable."""
    user = db.get(Utilisateur, principal.user_id)
    if not verify_password(body.actuel, user.password_hash):
        audit.record(db, user.id, "changement_mdp_echec", "utilisateur", user.id)
        db.commit()
        raise HTTPException(400, "Mot de passe actuel incorrect")
    check_password(body.nouveau)
    if verify_password(body.nouveau, user.password_hash):
        audit.record(db, user.id, "changement_mdp_refuse", "utilisateur", user.id)
        db.commit()
        raise HTTPException(422, "Le nouveau mot de passe doit être différent de l'actuel")
    user.password_hash = hash_password(body.nouveau)
    user.doit_changer_mdp = False
    audit.record(db, user.id, "changement_mdp", "utilisateur", user.id)
    db.commit()
    claims = read_claims(refresh_token, "refresh") if refresh_token else None
    _set_cookies(response, user, bool(claims and claims.get("rem")))
    return _me(to_principal(user))


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path=COOKIE_AUTH_PATH)
    return {"status": "ok"}


@router.get("/me")
def me(principal: Principal = Depends(session_principal)) -> dict:
    return _me(principal)


# Réglages d'affichage de l'utilisateur connecté (chacun ne voit que les siens).
CLE_PREFERENCE = Path(pattern=r"^(graphes|groupes)\.[a-z_]{1,30}$")


IdGraphe = Annotated[str, StringConstraints(min_length=1, max_length=50)]
NomGroupe = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=60)]
CleGroupe = Annotated[str, StringConstraints(pattern=r"^[a-z_]{1,30}$")]


class GroupePerso(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: IdGraphe
    nom: NomGroupe
    graphes: list[IdGraphe] = Field(min_length=1, max_length=4)


class ConfigGroupes(BaseModel):
    """Groupes de graphiques : groupes créés par l'utilisateur, ordre des groupes affichés
    (un groupe d'origine absent de `ordre` est masqué), vue d'ouverture (`tout` ou un groupe)
    et noms personnels des groupes d'origine, vus par l'utilisateur seul
    (priment sur les noms communs)."""

    model_config = ConfigDict(extra="forbid")

    perso: list[GroupePerso] = Field(max_length=20)
    ordre: list[IdGraphe] = Field(max_length=40)
    defaut: IdGraphe
    noms: Annotated[dict[CleGroupe, NomGroupe], Field(max_length=20)] | None = None


class PreferenceIn(BaseModel):
    valeur: Annotated[list[IdGraphe], Field(max_length=50)] | ConfigGroupes


def _preference(db: Session, uid: int, cle: str) -> PreferenceUtilisateur | None:
    return db.scalar(select(PreferenceUtilisateur).where(
        PreferenceUtilisateur.utilisateur_id == uid, PreferenceUtilisateur.cle == cle))


@router.get("/preferences/{cle}")
def lire_preference(cle: str = CLE_PREFERENCE, principal: Principal = Depends(current_principal),
                    db: Session = Depends(get_db)) -> dict:
    """`valeur` nulle : rien d'enregistré sur le serveur (réglage par défaut)."""
    p = _preference(db, principal.user_id, cle)
    return {"valeur": p.valeur if p else None}


@router.put("/preferences/{cle}")
def ecrire_preference(body: PreferenceIn, cle: str = CLE_PREFERENCE,
                      principal: Principal = Depends(current_principal),
                      db: Session = Depends(get_db)) -> dict:
    """Liste vide gardée (tout affiché) : la distinguer de « jamais enregistré » évite qu'un
    autre poste renvoie son ancienne copie locale."""
    if cle.startswith("groupes."):
        if not isinstance(body.valeur, ConfigGroupes):
            raise HTTPException(422, "Réglage des groupes : objet attendu")
        valeur = body.valeur.model_dump(exclude_none=True)
    else:
        if isinstance(body.valeur, ConfigGroupes):
            raise HTTPException(422, "Graphiques masqués : liste attendue")
        valeur = list(dict.fromkeys(body.valeur))
    p = _preference(db, principal.user_id, cle)
    if p:
        p.valeur = valeur
    else:
        db.add(PreferenceUtilisateur(utilisateur_id=principal.user_id, cle=cle, valeur=valeur))
    try:
        db.commit()
    except IntegrityError:  # premier envoi simultané : mettre à jour la ligne créée
        db.rollback()
        _preference(db, principal.user_id, cle).valeur = valeur
        db.commit()
    return {"valeur": valeur}
