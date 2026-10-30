from datetime import date
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    String,
    UniqueConstraint,
    func,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base
from app.models.donnees import MontantExact


class Parametre(Base):
    """Paramètre daté (jours_ouvres, budget_employe) : la valeur en vigueur est la plus récente."""

    __tablename__ = "parametre"
    __table_args__ = (UniqueConstraint("cle", "date_debut"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cle: Mapped[str] = mapped_column(String(40))
    valeur: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    date_debut: Mapped[date] = mapped_column(Date)


INDICATEURS = ("ca", "marge", "or", "devis", "factures", "obj_ca", "obj_marge", "obj_ventes",
               "obj_clients", "obj_factures", "obj_productivite")


class ValeurSaisie(Base):
    """Valeur saisie à la main pour un mois (CA, marge, OR, devis, factures) à un niveau :
    aucun site ni service = global, un seul = site ou service, les deux = case site x service.
    Case vide = pas de ligne."""

    __tablename__ = "valeur_saisie"
    __table_args__ = (
        CheckConstraint(
            "indicateur IN ('ca','marge','or','devis','factures','obj_ca','obj_marge',"
            "'obj_ventes','obj_clients','obj_factures','obj_productivite')",
            name="ck_valeur_saisie_indicateur"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"))
    indicateur: Mapped[str] = mapped_column(String(20))
    site_id: Mapped[int | None] = mapped_column(ForeignKey("site.id"), nullable=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("service.id"), nullable=True)
    valeur: Mapped[Decimal] = mapped_column(MontantExact)


# Un site ou un service absent compte pour 0 : la case globale est unique elle aussi.
Index("uq_valeur_saisie", ValeurSaisie.periode_id, ValeurSaisie.indicateur,
      func.coalesce(ValeurSaisie.site_id, 0), func.coalesce(ValeurSaisie.service_id, 0),
      unique=True)


class Budget(Base):
    """Budget mensuel par rubrique, service ou site (cible par id, sans clé étrangère)."""

    __tablename__ = "budget"
    __table_args__ = (
        UniqueConstraint("periode_id", "axe", "cible_id", name="uq_budget"),
        CheckConstraint("axe IN ('rubrique','service','site')", name="ck_budget_axe"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"))
    axe: Mapped[str] = mapped_column(String(10))
    cible_id: Mapped[int] = mapped_column(Integer)
    valeur: Mapped[Decimal] = mapped_column(Numeric(18, 3))
