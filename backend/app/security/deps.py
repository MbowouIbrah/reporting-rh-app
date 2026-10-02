from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.auth import Utilisateur
from app.security.policy import Assignment, Principal
from app.security.tokens import read_token


def to_principal(user: Utilisateur) -> Principal:
    return Principal(
        user_id=user.id,
        email=user.email,
        assignments=tuple(Assignment(r.role, r.perimetre_id, r.nominatif) for r in user.roles),
    )


def current_principal(
    access_token: str | None = Cookie(default=None), db: Session = Depends(get_db)
) -> Principal:
    uid = read_token(access_token, "access") if access_token else None
    user = db.get(Utilisateur, uid) if uid else None
    if user is None or not user.actif:
        raise HTTPException(status_code=401, detail="Non authentifié")
    return to_principal(user)
