from decimal import Decimal

import sqlalchemy as sa
from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    ForeignKey,
    Index,
    Integer,
    Numeric,
    SmallInteger,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from app.db.session import Base


class MontantExact(sa.types.TypeDecorator):
    """Montant gardé tel qu'importé, toutes ses décimales (NUMERIC sans échelle fixe).

    Relu avec au moins 3 décimales, zéros ajoutés, jamais arrondi : « 1000.500 », « 138700.4853 ».
    """

    impl = Numeric
    cache_ok = True

    def process_result_value(self, value, dialect):
        if value is None:
            return None
        v = Decimal(str(value)).normalize()
        return v if v.as_tuple().exponent <= -3 else v.quantize(Decimal("0.001"))

# SQLite n'autoincrémente que INTEGER PRIMARY KEY : variante pour les tests.
BigId = BigInteger().with_variant(Integer(), "sqlite")


class Periode(Base):
    __tablename__ = "periode"
    __table_args__ = (
        UniqueConstraint("annee", "mois"),
        CheckConstraint("mois BETWEEN 1 AND 12"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    annee: Mapped[int] = mapped_column(SmallInteger)
    mois: Mapped[int] = mapped_column(SmallInteger)


class Salarie(Base):
    __tablename__ = "salarie"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    matricule: Mapped[str] = mapped_column(String(30))
    matricule_norm: Mapped[str] = mapped_column(String(30), unique=True)
    nom: Mapped[str] = mapped_column(String(200))
    # Fiche employé : valeurs par défaut reprises à l'ajout d'une ligne mensuelle.
    poste_id: Mapped[int | None] = mapped_column(ForeignKey("poste.id"), nullable=True)
    service_id: Mapped[int | None] = mapped_column(ForeignKey("service.id"), nullable=True)
    site_id: Mapped[int | None] = mapped_column(ForeignKey("site.id"), nullable=True)
    activite_id: Mapped[int | None] = mapped_column(ForeignKey("activite.id"), nullable=True)
    type_contrat_id: Mapped[int | None] = mapped_column(
        ForeignKey("type_contrat.id"), nullable=True
    )
    actif: Mapped[bool] = mapped_column(Boolean, default=True, server_default=sa.true())


class SituationMensuelle(Base):
    __tablename__ = "situation_mensuelle"
    __table_args__ = (
        UniqueConstraint("periode_id", "salarie_id"),
        Index("ix_situation_periode_service", "periode_id", "service_id"),
    )

    id: Mapped[int] = mapped_column(BigId, primary_key=True)
    periode_id: Mapped[int] = mapped_column(ForeignKey("periode.id"))
    salarie_id: Mapped[int] = mapped_column(ForeignKey("salarie.id"))
    service_id: Mapped[int] = mapped_column(ForeignKey("service.id"))
    site_id: Mapped[int] = mapped_column(ForeignKey("site.id"))
    activite_id: Mapped[int] = mapped_column(ForeignKey("activite.id"))
    type_contrat_id: Mapped[int] = mapped_column(ForeignKey("type_contrat.id"))
    poste_id: Mapped[int | None] = mapped_column(ForeignKey("poste.id"), nullable=True)
    lot_import_id: Mapped[int | None] = mapped_column(ForeignKey("lot_import.id"), nullable=True)


class Montant(Base):
    """Une cellule saisie. Cellule vide = pas de ligne ; 0 saisi = ligne à 0."""

    __tablename__ = "montant"

    situation_id: Mapped[int] = mapped_column(
        ForeignKey("situation_mensuelle.id", ondelete="CASCADE"), primary_key=True
    )
    rubrique_id: Mapped[int] = mapped_column(ForeignKey("rubrique.id"), primary_key=True)
    valeur: Mapped[Decimal] = mapped_column(MontantExact())
