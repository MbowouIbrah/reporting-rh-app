from sqlalchemy.orm import Session

from app.models.auth import AuditEvent


def record(
    db: Session,
    user_id: int | None,
    action: str,
    entite: str,
    entite_id: object | None = None,
    avant: dict | None = None,
    apres: dict | None = None,
) -> None:
    """Ajoute l'événement à la transaction en cours : écriture et audit sont atomiques."""
    db.add(
        AuditEvent(
            utilisateur_id=user_id,
            action=action,
            entite=entite,
            entite_id=None if entite_id is None else str(entite_id),
            avant=avant,
            apres=apres,
        )
    )
