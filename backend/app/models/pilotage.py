from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
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


class CaPeriode(Base):
    """Chiffre d'affaires et marge saisis pour une période. Absent = pas de ligne."""

    __tablename__ = "ca_periode"

    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"), primary_key=True)
    valeur: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    marge: Mapped[Decimal | None] = mapped_column(Numeric(18, 3), nullable=True)


INDICATEURS = ("or", "devis", "factures")


class ActiviteSaisie(Base):
    """Indicateur d'activité saisi à la main (OR, devis, factures) par mois, site et service.
    Case vide = pas de ligne."""

    __tablename__ = "activite_saisie"
    __table_args__ = (
        UniqueConstraint("periode_id", "site_id", "service_id", "indicateur",
                         name="uq_activite_saisie"),
        CheckConstraint("indicateur IN ('or','devis','factures')", name="ck_activite_indicateur"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"))
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"))
    service_id: Mapped[int] = mapped_column(ForeignKey("service.id"))
    indicateur: Mapped[str] = mapped_column(String(10))
    valeur: Mapped[Decimal] = mapped_column(MontantExact)


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
