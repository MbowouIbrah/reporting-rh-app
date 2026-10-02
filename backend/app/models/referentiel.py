from datetime import date

from sqlalchemy import Boolean, CheckConstraint, Date, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class _Ref:
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    libelle: Mapped[str] = mapped_column(String(200), unique=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class Service(_Ref, Base):
    __tablename__ = "service"


class Activite(_Ref, Base):
    __tablename__ = "activite"


class Site(_Ref, Base):
    __tablename__ = "site"


class TypeContrat(_Ref, Base):
    __tablename__ = "type_contrat"


class Poste(_Ref, Base):
    __tablename__ = "poste"


DIMENSIONS = ("service", "activite", "site", "type_contrat", "poste", "rubrique", "mois")


class RefAlias(Base):
    __tablename__ = "ref_alias"
    __table_args__ = (
        UniqueConstraint("dimension", "alias_norm"),
        CheckConstraint(
            "dimension IN ('service','activite','site','type_contrat','poste','rubrique','mois')"
        ),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    dimension: Mapped[str] = mapped_column(String(20))
    alias_norm: Mapped[str] = mapped_column(String(200))
    cible_id: Mapped[int] = mapped_column(Integer)


class Rubrique(Base):
    __tablename__ = "rubrique"
    __table_args__ = (CheckConstraint("unite IN ('FCFA','jours')"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    libelle: Mapped[str] = mapped_column(String(200), unique=True)
    unite: Mapped[str] = mapped_column(String(10))
    ordre: Mapped[int] = mapped_column(Integer)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class RubriqueRegle(Base):
    """Exclusion datée d'une rubrique (total de ligne ou total général)."""

    __tablename__ = "rubrique_regle"
    __table_args__ = (
        CheckConstraint("regle IN ('exclu_total_ligne','exclu_total_general')"),
        CheckConstraint("date_fin IS NULL OR date_fin >= date_debut"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rubrique_id: Mapped[int] = mapped_column(ForeignKey("rubrique.id"))
    regle: Mapped[str] = mapped_column(String(30))
    date_debut: Mapped[date] = mapped_column(Date)
    date_fin: Mapped[date | None] = mapped_column(Date, nullable=True)
