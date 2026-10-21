from fastapi import Cookie, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.auth import Utilisateur
from app.security.policy import Portee, Principal
from app.security.tokens import read_token


def portee_de(user: Utilisateur) -> Portee:
    def valeurs(t: str) -> frozenset:
        return frozenset(
            (x.perimetre_id if t == "perimetre" else x.valeur) for x in user.portees if x.type == t
        )

    return Portee(
        tout=any(x.type == "tout" for x in user.portees),
        perimetres=valeurs("perimetre"),
        services=valeurs("service"),
        sites=valeurs("site"),
    )


def to_principal(user: Utilisateur) -> Principal:
    return Principal(
        user_id=user.id,
        email=user.email,
        nom=user.nom,
        fonction=user.fonction,
        permissions=frozenset(x.permission for x in user.permissions),
        portee=portee_de(user),
    )


def current_principal(
    access_token: str | None = Cookie(default=None), db: Session = Depends(get_db)
) -> Principal:
    uid = read_token(access_token, "access") if access_token else None
    user = db.get(Utilisateur, uid) if uid else None
    if user is None or not user.actif:
        raise HTTPException(status_code=401, detail="Non authentifié")
    return to_principal(user)
