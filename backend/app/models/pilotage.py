from datetime import date
from decimal import Decimal

from sqlalchemy import CheckConstraint, Date, ForeignKey, Integer, Numeric, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class Parametre(Base):
    """Paramètre daté (jours_ouvres, budget_employe) : la valeur en vigueur est la plus récente."""

    __tablename__ = "parametre"
    __table_args__ = (UniqueConstraint("cle", "date_debut"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    cle: Mapped[str] = mapped_column(String(40))
    valeur: Mapped[Decimal] = mapped_column(Numeric(18, 3))
    date_debut: Mapped[date] = mapped_column(Date)


class CaPeriode(Base):
    """Chiffre d'affaires global saisi pour une période. Absent = pas de ligne."""

    __tablename__ = "ca_periode"

    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"), primary_key=True)
    valeur: Mapped[Decimal] = mapped_column(Numeric(18, 3))


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
