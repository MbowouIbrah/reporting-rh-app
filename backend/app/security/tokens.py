from datetime import UTC, datetime, timedelta

import jwt

from app.core.config import settings


def make_token(user_id: int, kind: str) -> str:
    """kind : access | refresh. Claims OIDC : sub, iat, exp."""
    now = datetime.now(UTC)
    delta = (
        timedelta(minutes=settings.ACCESS_TOKEN_MINUTES)
        if kind == "access"
        else timedelta(days=settings.REFRESH_TOKEN_DAYS)
    )
    payload = {"sub": str(user_id), "typ": kind, "iat": now, "exp": now + delta}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.JWT_ALGORITHM)


def read_token(token: str, kind: str) -> int | None:
    try:
        data = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.JWT_ALGORITHM])
    except jwt.PyJWTError:
        return None
    if data.get("typ") != kind:
        return None
    try:
        return int(data["sub"])
    except (KeyError, ValueError):
        return None
