from datetime import date

from sqlalchemy import (
    Boolean,
    CheckConstraint,
    Date,
    ForeignKey,
    Integer,
    String,
    UniqueConstraint,
    false,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class _Ref:
    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    libelle: Mapped[str] = mapped_column(String(200), unique=True)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)


class Service(_Ref, Base):
    __tablename__ = "service"

    productif: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())


class Activite(_Ref, Base):
    __tablename__ = "activite"


TYPES_SITE = ("principal", "agence", "deporte")


class Site(_Ref, Base):
    __tablename__ = "site"
    __table_args__ = (CheckConstraint("type_site IN ('principal','agence','deporte')",
                                      name="ck_site_type_site"),)

    type_site: Mapped[str] = mapped_column(String(20), default="principal",
                                           server_default="principal")


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
    __table_args__ = (
        CheckConstraint("unite IN ('FCFA','jours','nombre')", name="ck_rubrique_unite"),
        CheckConstraint("nature IN ('paie','activite')", name="ck_rubrique_nature"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    libelle: Mapped[str] = mapped_column(String(200), unique=True)
    unite: Mapped[str] = mapped_column(String(10))
    ordre: Mapped[int] = mapped_column(Integer)
    actif: Mapped[bool] = mapped_column(Boolean, default=True)
    nature: Mapped[str] = mapped_column(String(10), default="paie", server_default="paie")


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
