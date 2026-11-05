from datetime import UTC, datetime

from sqlalchemy import (
    JSON,
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    false,
)
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
    fonction: Mapped[str] = mapped_column(String(200), default="", server_default="")  # sans effet
    # Mot de passe provisoire : tout est bloqué tant que la personne ne l'a pas changé.
    doit_changer_mdp: Mapped[bool] = mapped_column(Boolean, default=True, server_default=false())
    permissions: Mapped[list["UtilisateurPermission"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )
    portees: Mapped[list["UtilisateurPortee"]] = relationship(
        cascade="all, delete-orphan", lazy="selectin"
    )


class UtilisateurPermission(Base):
    """Permission accordée, code du catalogue de security/policy.py."""

    __tablename__ = "utilisateur_permission"
    __table_args__ = (UniqueConstraint("utilisateur_id", "permission"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateur.id", ondelete="CASCADE"))
    permission: Mapped[str] = mapped_column(String(30))


class UtilisateurPortee(Base):
    """Données accordées : tout, un périmètre (perimetre_id), un service ou un site (valeur)."""

    __tablename__ = "utilisateur_portee"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateur.id", ondelete="CASCADE"))
    type: Mapped[str] = mapped_column(String(20))  # tout | perimetre | service | site
    perimetre_id: Mapped[int | None] = mapped_column(ForeignKey("perimetre.id"), nullable=True)
    valeur: Mapped[str | None] = mapped_column(String(200), nullable=True)


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


class PreferenceUtilisateur(Base):
    """Réglage d'affichage propre à un utilisateur (ex. graphiques masqués), suivi partout."""

    __tablename__ = "preference_utilisateur"
    __table_args__ = (
        UniqueConstraint("utilisateur_id", "cle", name="uq_preference_utilisateur"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    utilisateur_id: Mapped[int] = mapped_column(ForeignKey("utilisateur.id", ondelete="CASCADE"))
    cle: Mapped[str] = mapped_column(String(60))
    valeur: Mapped[list | dict] = mapped_column(JsonType)


class ReglageGlobal(Base):
    """Réglage commun à tous (ex. noms des groupes de graphiques), modifié par un administrateur."""

    __tablename__ = "reglage_global"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cle: Mapped[str] = mapped_column(String(60), unique=True)
    valeur: Mapped[list | dict] = mapped_column(JsonType)
