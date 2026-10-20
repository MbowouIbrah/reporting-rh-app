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
    RoleAssignment,
    Utilisateur,
)
from app.security import audit
from app.security.deps import current_principal
from app.security.passwords import hash_password
from app.security.policy import Principal, Resource, authorize

router = APIRouter(tags=["admin"])

Role = Literal["rh_admin", "lecteur_global", "lecteur_perimetre"]


class RoleIn(BaseModel):
    role: Role
    perimetre_id: int | None = None
    nominatif: bool = False


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _email_valide(v: str | None) -> str | None:
    if v is not None and not EMAIL_RE.match(v.strip()):
        raise ValueError("Adresse e-mail invalide")
    return v


class UserIn(BaseModel):
    email: str
    nom: str
    password: str
    roles: list[RoleIn]

    _email = field_validator("email")(_email_valide)


class UserPatch(BaseModel):
    email: str | None = None
    nom: str | None = None
    actif: bool | None = None
    password: str | None = None
    roles: list[RoleIn] | None = None

    _email = field_validator("email")(_email_valide)


class RegleIn(BaseModel):
    dimension: Literal["service", "site"]
    valeur: str


class PerimetreIn(BaseModel):
    code: str
    libelle: str
    regles: list[RegleIn] = []


def _check_roles(roles: list[RoleIn]) -> None:
    for r in roles:
        if (r.role == "lecteur_perimetre") != (r.perimetre_id is not None):
            raise HTTPException(422, "lecteur_perimetre exige un périmètre (et lui seul)")


def _check_password(pw: str) -> None:
    if len(pw) < 12:
        raise HTTPException(422, "Mot de passe : 12 caractères minimum")


def _user_dict(u: Utilisateur) -> dict:
    return {
        "id": u.id,
        "email": u.email,
        "nom": u.nom,
        "actif": u.actif,
        "roles": [
            {"role": r.role, "perimetre_id": r.perimetre_id, "nominatif": r.nominatif}
            for r in u.roles
        ],
    }


def _perimetre_dict(p: Perimetre) -> dict:
    return {
        "id": p.id,
        "code": p.code,
        "libelle": p.libelle,
        "regles": [{"dimension": r.dimension, "valeur": r.valeur} for r in p.regles],
    }


def _est_admin_actif(u: Utilisateur) -> bool:
    return u.actif and any(r.role == "rh_admin" for r in u.roles)


def _exiger_autre_admin(db: Session, u: Utilisateur) -> None:
    """Garde : au moins un rh_admin actif doit subsister après l'opération."""
    autres = db.scalars(select(Utilisateur).where(Utilisateur.id != u.id)).all()
    if not any(_est_admin_actif(x) for x in autres):
        raise HTTPException(409, "Il doit rester au moins un administrateur actif")


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


# ---- Utilisateurs (rh_admin seul) ----
@router.get("/users")
def list_users(p: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    authorize(p, "users:read")
    return [_user_dict(u) for u in db.scalars(select(Utilisateur).order_by(Utilisateur.id))]


@router.post("/users", status_code=201)
def create_user(
    body: UserIn, p: Principal = Depends(current_principal), db: Session = Depends(get_db)
):
    authorize(p, "users:write")
    _check_roles(body.roles)
    _check_password(body.password)
    u = Utilisateur(
        email=body.email.strip().lower(),
        nom=body.nom,
        password_hash=hash_password(body.password),
        roles=[RoleAssignment(**r.model_dump()) for r in body.roles],
    )
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
    if _est_admin_actif(u):
        perd_actif = body.actif is False
        perd_role = body.roles is not None and not any(r.role == "rh_admin" for r in body.roles)
        if perd_actif or perd_role:
            _exiger_autre_admin(db, u)
    # La session porte l'id du compte : changer l'adresse ne déconnecte personne.
    if body.email is not None:
        u.email = body.email.strip().lower()
    if body.nom is not None:
        u.nom = body.nom
    if body.actif is not None:
        u.actif = body.actif
    if body.password is not None:
        _check_password(body.password)
        u.password_hash = hash_password(body.password)
    if body.roles is not None:
        _check_roles(body.roles)
        u.roles.clear()
        u.roles.extend(RoleAssignment(**r.model_dump()) for r in body.roles)
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
        mine = {a.perimetre_id for a in p.assignments}
        rows = [r for r in rows if r.id in mine]
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
