import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, BackgroundTasks, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app import mail
from app.core.config import settings
from app.db.session import SessionLocal, get_db
from app.models.auth import AuditEvent, Utilisateur
from app.security import audit
from app.security.deps import current_principal, to_principal
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
    user.password_hash = hash_password(body.password)
    audit.record(db, user.id, "reinit_mdp", "utilisateur", user.id)
    db.commit()
    return {"status": "ok"}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path=COOKIE_AUTH_PATH)
    return {"status": "ok"}


@router.get("/me")
def me(principal: Principal = Depends(current_principal)) -> dict:
    return _me(principal)
