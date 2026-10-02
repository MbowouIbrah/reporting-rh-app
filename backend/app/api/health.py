from fastapi import APIRouter, Depends, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_db

router = APIRouter(tags=["health"])


@router.get("/health")
def health() -> dict[str, str]:
    """Vivacité du processus (sans accès base)."""
    return {"status": "ok"}


@router.get("/health/ready")
def ready(response: Response, db: Session = Depends(get_db)) -> dict[str, str]:
    """Disponibilité : la base répond."""
    try:
        db.execute(text("SELECT 1"))
    except Exception:
        response.status_code = 503
        return {"status": "db_indisponible"}
    return {"status": "ok"}
