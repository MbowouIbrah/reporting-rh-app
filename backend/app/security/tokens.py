import hashlib
from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import settings


def make_token(user_id: int, kind: str, **claims) -> str:
    """kind : access | refresh | reset. Claims OIDC : sub, iat, exp, plus **claims."""
    now = datetime.now(UTC)
    if kind == "access":
        delta = timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
    elif kind == "reset":
        delta = timedelta(minutes=settings.RESET_TOKEN_MINUTES)
    else:
        delta = timedelta(days=settings.REFRESH_TOKEN_DAYS)
    payload = {**claims, "sub": str(user_id), "typ": kind, "iat": now, "exp": now + delta}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def read_claims(token: str, kind: str) -> dict | None:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    return data if data.get("typ") == kind else None


def read_token(token: str, kind: str) -> int | None:
    data = read_claims(token, kind)
    if data is None:
        return None
    try:
        return int(data["sub"])
    except (KeyError, ValueError):
        return None


def empreinte(password_hash: str) -> str:
    """Lie un jeton au mot de passe courant : invalide dès que celui-ci change."""
    return hashlib.sha256(password_hash.encode()).hexdigest()[:16]
