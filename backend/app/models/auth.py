from datetime import UTC, datetime

from sqlalchemy import JSON, Boolean, DateTime, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base

JsonType = JSON().with_variant(JSONB(), "postgresql")


def _now() -> datetime:
    return datetime.now(UTC)


class Perimetre(Base):
    __tablename__ = "perimetre"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    code: Mapped[str] = mapped_column(String(50), unique=True)
    libelle: Mapped[str] = mapped_column(String(200))
    regles: Mapped[list["PerimetreRegle"]] = relationship(
        back_populates="perimetre", cascade="all, delete-orphan", lazy="selectin"
    )


class PerimetreRegle(Base):
    """Une valeur de dimension (service, site) incluse dans un périmètre."""

    __tablename__ = "perimetre_regle"
    __table_args__ = (UniqueConstraint("perimetre_id", "dimension", "valeur"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    perimetre_id: Mapped[int] = mapped_column(ForeignKey("perimetre.id", ondelete="CASCADE"))
    dimension: Mapped[str] = mapped_column(String(20))  # service | site
    valeur: Mapped[str] = mapped_column(String(200))
    perimetre: Mapped[Perimetre] = relationship(back_populates="regles")


class Utilisateur(Base):
    __tablename__ = "utilisateur"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True)
    nom: Mapped[str] = mapped_column(String(200))
    password_hash: Mapped[str] = mapped_column(String(100))
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    roles: Mapped[list["RoleAssignment"]] = relationship(
        back_populates="utilisateur", cascade="all, delete-orphan", lazy="selectin"
    )


class RoleAssignment(Base):
    __tablename__ = "role_assignment"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateur.id", ondelete="CASCADE"))
    role: Mapped[str] = mapped_column(String(30))  # rh_admin | lecteur_global | lecteur_perimetre
    perimetre_id: Mapped[int | None] = mapped_column(ForeignKey("perimetre.id"), nullable=True)
    nominatif: Mapped[bool] = mapped_column(Boolean, default=False)
    utilisateur: Mapped[Utilisateur] = relationship(back_populates="roles")


class AuditEvent(Base):
    __tablename__ = "audit_event"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    ts: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now, index=True)
    utilisateur_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    action: Mapped[str] = mapped_column(String(50))
    entite: Mapped[str] = mapped_column(String(50))
    entite_id: Mapped[str | None] = mapped_column(String(50), nullable=True)
    avant: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
    apres: Mapped[dict | None] = mapped_column(JsonType, nullable=True)
