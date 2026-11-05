from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (
    CheckConstraint,
    Date,
    DateTime,
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
from app.models.auth import _now
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
    # Dernier changement de la valeur elle-même : réenregistrer le même chiffre ne la change pas.
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)
    # « Garder la saisie » choisi : le conflit reste réglé tant que les employés ne changent pas.
    tranche_le: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


# Un site ou un service absent compte pour 0 : la case globale est unique elle aussi.
Index("uq_valeur_saisie", ValeurSaisie.periode_id, ValeurSaisie.indicateur,
      func.coalesce(ValeurSaisie.site_id, 0), func.coalesce(ValeurSaisie.service_id, 0),
      unique=True)


class DateEmployes(Base):
    """Dernier changement réel de la somme CA ou marge des employés, à chaque niveau de case
    (site vide = tous les sites, service vide = tous les services) : une somme globale inchangée
    ne date pas le global quand un montant passe d'une case à l'autre.
    Pas de ligne = pas de date connue : plus ancien que toute saisie."""

    __tablename__ = "date_employes"

    id: Mapped[int] = mapped_column(primary_key=True)
    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"))
    indicateur: Mapped[str] = mapped_column(String(20))
    site_id: Mapped[int | None] = mapped_column(ForeignKey("site.id"))
    service_id: Mapped[int | None] = mapped_column(ForeignKey("service.id"))
    modifie_le: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_now)


Index("uq_date_employes", DateEmployes.periode_id, DateEmployes.indicateur,
      func.coalesce(DateEmployes.site_id, 0), func.coalesce(DateEmployes.service_id, 0),
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
