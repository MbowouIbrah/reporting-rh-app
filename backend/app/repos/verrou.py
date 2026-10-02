from fastapi import HTTPException
from sqlalchemy.orm import Session

from app.models.donnees import Periode


def exiger_ouverte(db: Session, periode_id: int) -> None:
    """Verrou commun : toute écriture datée est refusée sur une période close."""
    per = db.get(Periode, periode_id)
    if per is not None and per.statut == "close":
        raise HTTPException(409, "Période close")
