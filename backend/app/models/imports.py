from datetime import datetime

from sqlalchemy import (
    JSON,
    Boolean,
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    SmallInteger,
    String,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.auth import JsonType, _now
from app.models.donnees import BigId

_ACTIF = "statut IN ('pret','valide')"


class LotImport(Base):
    __tablename__ = "lot_import"
    __table_args__ = (
        CheckConstraint("statut IN ('pret','rejete','valide','annule')"),
        Index(
            "uq_lot_sha256_actif",
            "sha256",
            unique=True,
            postgresql_where=text(_ACTIF),
            sqlite_where=text(_ACTIF),
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    fichier_nom: Mapped[str] = mapped_column(String(255))
    sha256: Mapped[str] = mapped_column(String(64))
    taille: Mapped[int] = mapped_column(Integer)
    statut: Mapped[str] = mapped_column(String(10))
    cree_par: Mapped[int | None] = mapped_column(Integer, nullable=True)
    cree_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    valide_par: Mapped[int | None] = mapped_column(Integer, nullable=True)
    valide_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    annule_par: Mapped[int | None] = mapped_column(Integer, nullable=True)
    annule_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    nb_lignes: Mapped[int] = mapped_column(Integer, default=0)
    nb_bloquants: Mapped[int] = mapped_column(Integer, default=0)
    nb_avert: Mapped[int] = mapped_column(Integer, default=0)
    stats: Mapped[dict | None] = mapped_column(JSON, nullable=True)


class StagingLigne(Base):
    __tablename__ = "staging_ligne"
    __table_args__ = (Index("ix_staging_lot", "lot_id"),)

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lot_import.id", ondelete="CASCADE"))
    num_ligne: Mapped[int] = mapped_column(Integer)
    annee: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    mois: Mapped[int | None] = mapped_column(SmallInteger, nullable=True)
    matricule: Mapped[str | None] = mapped_column(String(30), nullable=True)
    donnees: Mapped[dict] = mapped_column(JSON)  # montants en chaînes (Decimal exact)
    bloquant: Mapped[bool] = mapped_column(Boolean, default=False)


class ImportAnomalie(Base):
    __tablename__ = "import_anomalie"
    __table_args__ = (Index("ix_anomalie_lot_gravite", "lot_id", "gravite"),)

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lot_import.id", ondelete="CASCADE"))
    num_ligne: Mapped[int | None] = mapped_column(Integer, nullable=True)
    colonne: Mapped[str | None] = mapped_column(String(100), nullable=True)
    code: Mapped[str] = mapped_column(String(40))
    gravite: Mapped[str] = mapped_column(String(12))  # bloquant | avertissement
    valeur: Mapped[str | None] = mapped_column(String(500), nullable=True)
    message: Mapped[str] = mapped_column(String(500))


class LotImportPrecedent(Base):
    """État remplacé par un lot validé, pour restauration à l'annulation."""

    __tablename__ = "lot_import_precedent"

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    lot_id: Mapped[int] = mapped_column(ForeignKey("lot_import.id", ondelete="CASCADE"), index=True)
    periode_id: Mapped[int] = mapped_column(Integer)
    salarie_id: Mapped[int] = mapped_column(Integer)
    etat: Mapped[dict] = mapped_column(JsonType)
