from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, SmallInteger, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.auth import _now


class Notification(Base):
    """Message affiché dans la cloche d'un utilisateur (jamais de montant)."""

    __tablename__ = "notification"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(
        ForeignKey("utilisateur.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(40))
    titre: Mapped[str] = mapped_column(String(200))
    texte: Mapped[str] = mapped_column(String(500))
    lien: Mapped[str | None] = mapped_column(String(200), nullable=True)
    lot_id: Mapped[int | None] = mapped_column(
        ForeignKey("lot_import.id", ondelete="SET NULL"), nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    lue_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class NotificationEnvoi(Base):
    """Registre des envois « données du mois disponibles » : un seul par utilisateur, mois et canal,
    même si le mois est republié."""

    __tablename__ = "notification_envoi"
    __table_args__ = (UniqueConstraint("utilisateur_id", "annee", "mois", "canal"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateur.id", ondelete="CASCADE"))
    annee: Mapped[int] = mapped_column(SmallInteger)
    mois: Mapped[int] = mapped_column(SmallInteger)
    canal: Mapped[str] = mapped_column(String(10))  # appli | mail
    envoye_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
