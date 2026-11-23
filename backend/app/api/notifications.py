"""Notifications de l'utilisateur connecté : cloche, préférence e-mail, désabonnement par jeton."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.orm import Session

from app import notifications
from app.db.session import get_db
from app.models.auth import Utilisateur
from app.models.notifications import Notification
from app.security import audit
from app.security.deps import current_principal
from app.security.policy import Principal

router = APIRouter(prefix="/notifications", tags=["notifications"])


class PreferencesIn(BaseModel):
    notif_mail: bool


class DesabonnerIn(BaseModel):
    jeton: str


def _dict(n: Notification) -> dict:
    return {"id": n.id, "type": n.type, "titre": n.titre, "texte": n.texte, "lien": n.lien,
            "cree_le": n.cree_le.isoformat(), "lue": n.lue_le is not None}


@router.get("")
def lister(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    liste = db.scalars(select(Notification).where(Notification.utilisateur_id == p.user_id)
                       .order_by(Notification.cree_le.desc(), Notification.id.desc()).limit(50))
    non_lues = db.scalar(select(func.count()).select_from(Notification).where(
        Notification.utilisateur_id == p.user_id, Notification.lue_le.is_(None)))
    return {"notifications": [_dict(n) for n in liste], "non_lues": non_lues or 0}


@router.post("/tout-lu")
def tout_lu(p: Principal = Depends(current_principal), db: Session = Depends(get_db)) -> dict:
    db.execute(update(Notification).where(Notification.utilisateur_id == p.user_id,
                                          Notification.lue_le.is_(None))
               .values(lue_le=datetime.now(UTC)))
    db.commit()
    return {"status": "ok"}


@router.get("/preferences")
def lire_preferences(p: Principal = Depends(current_principal),
                     db: Session = Depends(get_db)) -> dict:
    return {"notif_mail": db.get(Utilisateur, p.user_id).notif_mail}


@router.put("/preferences")
def ecrire_preferences(body: PreferencesIn, p: Principal = Depends(current_principal),
                       db: Session = Depends(get_db)) -> dict:
    user = db.get(Utilisateur, p.user_id)
    avant = {"notif_mail": user.notif_mail}
    notifications.regler_mail(user, body.notif_mail)
    audit.record(db, user.id, "notif_mail_preference", "utilisateur", user.id, avant,
                 {"notif_mail": user.notif_mail})
    db.commit()
    return {"notif_mail": user.notif_mail}


@router.post("/desabonner")
def desabonner(body: DesabonnerIn, db: Session = Depends(get_db)) -> dict:
    """Sans session : le jeton signé du lien de l'e-mail suffit (envoyé sur clic)."""
    uid = notifications.lire_jeton(body.jeton)
    user = db.get(Utilisateur, uid) if uid else None
    if user is None:
        raise HTTPException(400, "Lien invalide")
    if user.notif_mail:
        notifications.regler_mail(user, False)
        audit.record(db, user.id, "notif_mail_desabonnement", "utilisateur", user.id,
                     {"notif_mail": True}, {"notif_mail": False})
        db.commit()
    return {"status": "ok"}


@router.post("/{notif_id}/lue")
def lue(notif_id: int, p: Principal = Depends(current_principal),
        db: Session = Depends(get_db)) -> dict:
    n = db.get(Notification, notif_id)
    if n is None or n.utilisateur_id != p.user_id:
        raise HTTPException(404, "Notification introuvable")
    if n.lue_le is None:
        n.lue_le = datetime.now(UTC)
        db.commit()
    return {"status": "ok"}
