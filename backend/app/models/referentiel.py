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


class Departement(_Ref, Base):
    __tablename__ = "departement"


class Service(_Ref, Base):
    __tablename__ = "service"

    productif: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # Département (BU) du service ; vide = non rattaché.
    departement_id: Mapped[int | None] = mapped_column(
        ForeignKey("departement.id", name="fk_service_departement"), nullable=True)


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

    # Activité du poste (Front office / Back Office) : la ligne importée la reprend.
    activite_id: Mapped[int | None] = mapped_column(ForeignKey("activite.id"), nullable=True)


DIMENSIONS = ("service", "activite", "site", "type_contrat", "poste", "rubrique", "mois",
              "departement")


class RefAlias(Base):
    __tablename__ = "ref_alias"
    __table_args__ = (
        UniqueConstraint("dimension", "alias_norm"),
        CheckConstraint(
            "dimension IN ('service','activite','site','type_contrat','poste','rubrique','mois',"
            "'departement')",
            name="ck_ref_alias_dimension",
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


class CorrespondancePaie(Base):
    """Colonne de l'export de paie -> rubrique de l'application (plusieurs colonnes peuvent viser la
    même rubrique : leurs montants sont additionnés)."""

    __tablename__ = "correspondance_paie"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    colonne: Mapped[str] = mapped_column(String(200))
    colonne_norm: Mapped[str] = mapped_column(String(200), unique=True)
    rubrique_id: Mapped[int] = mapped_column(ForeignKey("rubrique.id"))


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
