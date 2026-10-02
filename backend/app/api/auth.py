from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import get_db
from app.models.auth import Utilisateur
from app.security import audit
from app.security.deps import current_principal, to_principal
from app.security.passwords import hash_password, verify_password
from app.security.policy import POLICY, Principal, is_allowed
from app.security.tokens import make_token, read_token

router = APIRouter(prefix="/auth", tags=["auth"])
COOKIE_AUTH_PATH = f"{settings.COOKIE_PATH_PREFIX}{settings.API_PREFIX}/auth"

# Hash factice : la durée de vérification ne révèle pas si l'e-mail existe.
_DUMMY_HASH = hash_password("dummy-password")


class LoginIn(BaseModel):
    email: str
    password: str


def _set_cookies(response: Response, user_id: int) -> None:
    opts = {"httponly": True, "secure": settings.COOKIE_SECURE, "samesite": "strict"}
    response.set_cookie(
        "access_token",
        make_token(user_id, "access"),
        max_age=settings.ACCESS_TOKEN_MINUTES * 60,
        path="/",
        **opts,
    )
    response.set_cookie(
        "refresh_token",
        make_token(user_id, "refresh"),
        max_age=settings.REFRESH_TOKEN_DAYS * 86400,
        path=COOKIE_AUTH_PATH,
        **opts,
    )


def _me(p: Principal) -> dict:
    return {
        "id": p.user_id,
        "email": p.email,
        "roles": [
            {"role": a.role, "perimetre_id": a.perimetre_id, "nominatif": a.nominatif}
            for a in p.assignments
        ],
        "permissions": sorted(
            a for a in set().union(*POLICY.values()) if is_allowed(p, a)
        ),
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
    _set_cookies(response, user.id)
    return _me(to_principal(user))


@router.post("/refresh")
def refresh(
    response: Response,
    refresh_token: str | None = Cookie(default=None),
    db: Session = Depends(get_db),
) -> dict:
    uid = read_token(refresh_token, "refresh") if refresh_token else None
    user = db.get(Utilisateur, uid) if uid else None
    if user is None or not user.actif:
        raise HTTPException(status_code=401, detail="Session expirée")
    _set_cookies(response, user.id)
    return {"status": "ok"}


@router.post("/logout")
def logout(response: Response) -> dict:
    response.delete_cookie("access_token", path="/")
    response.delete_cookie("refresh_token", path=COOKIE_AUTH_PATH)
    return {"status": "ok"}


@router.get("/me")
def me(principal: Principal = Depends(current_principal)) -> dict:
    return _me(principal)
