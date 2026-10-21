import re
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.auth import (
    AuditEvent,
    Perimetre,
    PerimetreRegle,
    Utilisateur,
    UtilisateurPermission,
    UtilisateurPortee,
)
from app.models.referentiel import Service, Site
from app.security import audit
from app.security.deps import current_principal, portee_de, to_principal
from app.security.passwords import hash_password
from app.security.policy import (
    ACCORDABLES,
    PERMISSIONS,
    Principal,
    Resource,
    authorize,
    is_allowed,
)

router = APIRouter(tags=["admin"])

Code = Literal[ACCORDABLES]


class PorteeIn(BaseModel):
    tout: bool = False
    perimetres: list[int] = []
    services: list[str] = []
    sites: list[str] = []


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email_valide(v: str | None) -> str | None:
    if v is not None and not EMAIL_RE.match(v.strip()):
        raise ValueError("Adresse e-mail invalide")
    return v


class UserIn(BaseModel):
    email: str
    nom: str
    password: str
    fonction: str = ""
    permissions: list[Code] = []
    portee: PorteeIn = PorteeIn()

    _email = field_validator("email")(_email_valide)


class UserPatch(BaseModel):
    email: str | None = None
    nom: str | None = None
    actif: bool | None = None
    password: str | None = None
    fonction: str | None = None
    permissions: list[Code] | None = None
    portee: PorteeIn | None = None

    _email = field_validator("email")(_email_valide)


class RegleIn(BaseModel):
    dimension: Literal["service", "site"]
    valeur: str


class PerimetreIn(BaseModel):
    code: str
    libelle: str
    regles: list[RegleIn] = []

    @field_validator("regles")
    @classmethod
    def _une_dimension(cls, v: list[RegleIn]) -> list[RegleIn]:
        # Services ET sites dans un même périmètre se croiseraient avec ceux d'un autre
        # périmètre accordé (filtre par dimension) : un périmètre porte une seule dimension.
        if len({r.dimension for r in v}) > 1:
            raise ValueError("un périmètre porte soit des services, soit des sites")
        return v


def _check_droits(db: Session, permissions: list[str], portee: PorteeIn) -> None:
    """Écriture et CA réservés à « toutes les données » ; valeurs accordées connues."""
    if not portee.tout:
        for code in permissions:
            if PERMISSIONS[code].portee_tout:
                raise HTTPException(
                    422, f"« {PERMISSIONS[code].libelle} » exige l'accès à toutes les données"
                )
    for pid in portee.perimetres:
        if db.get(Perimetre, pid) is None:
            raise HTTPException(422, f"Périmètre inconnu : {pid}")
    for model, vals in ((Service, portee.services), (Site, portee.sites)):
        connus = set(db.scalars(select(model.libelle).where(model.libelle.in_(vals))))
        if inconnus := set(vals) - connus:
            raise HTTPException(422, f"Valeur inconnue : {', '.join(sorted(inconnus))}")


def _poser_droits(u: Utilisateur, permissions: list[str] | None, portee: PorteeIn | None) -> None:
    if permissions is not None:
        # Garder les lignes existantes : l'unité de travail insère avant de supprimer (unicité).
        voulues = set(permissions)
        gardees = {x.permission: x for x in u.permissions if x.permission in voulues}
        u.permissions[:] = [gardees.get(c) or UtilisateurPermission(permission=c)
                            for c in sorted(voulues)]
    if portee is not None:
        u.portees.clear()
        if portee.tout:
            u.portees.append(UtilisateurPortee(type="tout"))
        else:
            u.portees.extend(UtilisateurPortee(type="perimetre", perimetre_id=i)
                             for i in sorted(set(portee.perimetres)))
            u.portees.extend(UtilisateurPortee(type="service", valeur=v)
                             for v in sorted(set(portee.services)))
            u.portees.extend(UtilisateurPortee(type="site", valeur=v)
                             for v in sorted(set(portee.sites)))


def _check_password(pw: str) -> None:
    if len(pw) < 12:
        raise HTTPException(422, "Mot de passe : 12 caractères minimum")


def _user_dict(u: Utilisateur) -> dict:
    portee = portee_de(u)
    return {
        "id": u.id,
        "email": u.email,
        "nom": u.nom,
        "fonction": u.fonction,
        "actif": u.actif,
        "permissions": sorted(x.permission for x in u.permissions),
        "portee": {
            "tout": portee.tout,
            "perimetres": sorted(portee.perimetres),
            "services": sorted(portee.services),
            "sites": sorted(portee.sites),
        },
    }


def _perimetre_dict(p: Perimetre) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "libelle": p.libelle,
        "regles": [{"dimension": r.dimension, "valeur": r.valeur} for r in p.regles],
    }


def _est_admin_actif(u: Utilisateur) -> bool:
    """Compte actif qui gère les comptes (la permission exige « toutes les données »)."""
    return u.actif and is_allowed(to_principal(u), "users:write")


def _exiger_autre_admin(db: Session, u: Utilisateur) -> None:
    """Garde : au moins un compte actif doit encore gérer les comptes après l'opération."""
    autres = db.scalars(select(Utilisateur).where(Utilisateur.id != u.id)).all()
    if not any(_est_admin_actif(x) for x in autres):
        raise HTTPException(409, "Il doit rester au moins un compte qui gère les comptes")


def _flush(db: Session) -> None:
    try:
        db.flush()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Conflit : doublon ou référence invalide") from None


def _commit(db: Session) -> None:
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise HTTPException(409, "Conflit : doublon ou référence invalide") from None


# ---- Utilisateurs (permission « Gérer les comptes et les droits ») ----
@router.get("/users")
def list_users(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "users:read")
    return [_user_dict(u) for u in db.scalars(select(Utilisateur).order_by(Utilisateur.id))]


@router.post("/users", status_code=201)
def create_user(
    body: UserIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "users:write")
    _check_droits(db, body.permissions, body.portee)
    _check_password(body.password)
    u = Utilisateur(
        email=body.email.strip().lower(),
        nom=body.nom,
        fonction=body.fonction.strip(),
        password_hash=hash_password(body.password),
    )
    _poser_droits(u, body.permissions, body.portee)
    db.add(u)
    _flush(db)
    audit.record(db, p.user_id, "create", "utilisateur", u.id, None, _user_dict(u))
    _commit(db)
    return _user_dict(u)


@router.put("/users/{user_id}")
def update_user(
    user_id: int,
    body: UserPatch,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "users:write")
    u = db.get(Utilisateur, user_id)
    if u is None:
        raise HTTPException(404, "Utilisateur introuvable")
    avant = _user_dict(u)
    if body.permissions is not None or body.portee is not None:
        _check_droits(
            db,
            body.permissions if body.permissions is not None else avant["permissions"],
            body.portee or PorteeIn(**avant["portee"]),
        )
    etait_admin = _est_admin_actif(u)
    # La session porte l'id du compte : changer l'adresse ne déconnecte personne.
    if body.email is not None:
        u.email = body.email.strip().lower()
    if body.nom is not None:
        u.nom = body.nom
    if body.fonction is not None:
        u.fonction = body.fonction.strip()
    if body.actif is not None:
        u.actif = body.actif
    if body.password is not None:
        _check_password(body.password)
        u.password_hash = hash_password(body.password)
    _poser_droits(u, body.permissions, body.portee)
    if etait_admin and not _est_admin_actif(u):
        if u.id == p.user_id:
            raise HTTPException(409, "Impossible de se retirer à soi-même la gestion des comptes")
        _exiger_autre_admin(db, u)
    _flush(db)
    audit.record(db, p.user_id, "update", "utilisateur", u.id, avant, _user_dict(u))
    _commit(db)
    return _user_dict(u)


@router.delete("/users/{user_id}", status_code=204)
def delete_user(
    user_id: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "users:write")
    if user_id == p.user_id:
        raise HTTPException(409, "Auto-suppression interdite")
    u = db.get(Utilisateur, user_id)
    if u is None:
        raise HTTPException(404, "Utilisateur introuvable")
    if _est_admin_actif(u):
        _exiger_autre_admin(db, u)
    audit.record(db, p.user_id, "delete", "utilisateur", u.id, _user_dict(u), None)
    db.delete(u)
    _commit(db)


# ---- Périmètres : lecture bornée au(x) périmètre(s) du lecteur ----
@router.get("/perimetres")
def list_perimetres(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "perimetre:read")
    rows = db.scalars(select(Perimetre).order_by(Perimetre.id)).all()
    if not p.is_global:
        rows = [r for r in rows if r.id in p.portee.perimetres]
    return [_perimetre_dict(r) for r in rows]


@router.get("/perimetres/{pid}")
def get_perimetre(
    pid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "perimetre:read", Resource(perimetre_id=pid))
    row = db.get(Perimetre, pid)
    if row is None:
        raise HTTPException(404, "Périmètre introuvable")
    return _perimetre_dict(row)


@router.post("/perimetres", status_code=201)
def create_perimetre(
    body: PerimetreIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "perimetre:write")
    row = Perimetre(
        code=body.code,
        libelle=body.libelle,
        regles=[PerimetreRegle(**r.model_dump()) for r in body.regles],
    )
    db.add(row)
    _flush(db)
    audit.record(db, p.user_id, "create", "perimetre", row.id, None, _perimetre_dict(row))
    _commit(db)
    return _perimetre_dict(row)


@router.put("/perimetres/{pid}")
def update_perimetre(
    pid: int,
    body: PerimetreIn,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "perimetre:write")
    row = db.get(Perimetre, pid)
    if row is None:
        raise HTTPException(404, "Périmètre introuvable")
    avant = _perimetre_dict(row)
    row.code, row.libelle = body.code, body.libelle
    row.regles.clear()
    _flush(db)
    row.regles.extend(PerimetreRegle(**r.model_dump()) for r in body.regles)
    _flush(db)
    audit.record(db, p.user_id, "update", "perimetre", row.id, avant, _perimetre_dict(row))
    _commit(db)
    return _perimetre_dict(row)


@router.delete("/perimetres/{pid}", status_code=204)
def delete_perimetre(
    pid: int, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "perimetre:write")
    row = db.get(Perimetre, pid)
    if row is None:
        raise HTTPException(404, "Périmètre introuvable")
    comptes = db.scalars(select(Utilisateur.email).join(UtilisateurPortee).where(
        UtilisateurPortee.perimetre_id == pid).order_by(Utilisateur.email)).all()
    if comptes:
        raise HTTPException(409, f"Périmètre accordé à : {', '.join(comptes)}")
    audit.record(db, p.user_id, "delete", "perimetre", row.id, _perimetre_dict(row), None)
    db.delete(row)
    _commit(db)


# ---- Journal d'audit ----
@router.get("/audit")
def list_audit(
    limit: int = 100,
    offset: int = 0,
    entite: str | None = None,
    entite_id: str | None = None,
    p: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    authorize(p, "audit:read")
    q = select(AuditEvent).order_by(AuditEvent.id.desc())
    if entite:
        q = q.where(AuditEvent.entite == entite)
    if entite_id:
        q = q.where(AuditEvent.entite_id == entite_id)
    q = q.offset(max(offset, 0)).limit(min(max(limit, 1), 500))
    return [
        {
            "id": e.id,
            "ts": e.ts.isoformat(),
            "utilisateur_id": e.utilisateur_id,
            "action": e.action,
            "entite": e.entite,
            "entite_id": e.entite_id,
            "avant": e.avant,
            "apres": e.apres,
        }
        for e in db.scalars(q)
    ]
