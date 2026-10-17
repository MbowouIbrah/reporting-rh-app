"""Référentiels initiaux (mêmes listes que templates/ et tools/generer_template_import.py)."""

from datetime import date
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.pilotage import Parametre
from app.models.referentiel import (
    Activite,
    RefAlias,
    Rubrique,
    RubriqueRegle,
    Service,
    Site,
    TypeContrat,
)

SERVICES = ["Commerce VN", "Commerce Pièces", "Administration", "SAV PL",
            "SAV Engins", "Sites Déportés", "Pneumatique"]
ACTIVITES = ["Front office", "Back Office"]
CONTRATS = ["CDI", "CDD", "MAD"]
SITES = ["Yaoundé", "Douala", "Bertoua", "Ngaoundéré", "Garoua", "Dehane",
         "Libongo", "Njombe", "Dimon", "Nkoteng"]
RUBRIQUES = [
    ("Absences (nb)", "jours"), ("Primes sur ventes", "FCFA"),
    ("Primes sur résultats", "FCFA"), ("Bonus", "FCFA"),
    ("Productivité Ateliers", "FCFA"), ("Commission", "FCFA"),
    ("Salaire brut garantie", "FCFA"), ("Frais de mission", "FCFA"),
    ("Primes exceptionnelles", "FCFA"), ("Logement site déporté", "FCFA"),
    ("Carburant véhicule service", "FCFA"), ("Crédit téléphonique", "FCFA"),
    ("Brut Réel", "FCFA"), ("Charges Patronales", "FCFA"),
    ("Assurance Maladie", "FCFA"), ("Formation", "FCFA"),
    ("TVA & Marge MAD", "FCFA"),
]
# Règles d'exclusion du total de ligne à date d'effet (docs/P0_CADRAGE.md §1).
EXCLUES_TOTAL_LIGNE = ["Absences (nb)", "Salaire brut garantie", "Primes sur ventes",
                       "Primes sur résultats", "Productivité Ateliers", "Commission"]
DEBUT = date(2000, 1, 1)
PARAMETRES_DEFAUT = {"jours_ouvres": "22", "budget_employe": "600000"}


def _fill(db: Session, model, libelles: list[str]) -> None:
    existants = set(db.scalars(select(model.libelle)))
    db.add_all(model(libelle=x) for x in libelles if x not in existants)


def seed_referentiels(db: Session) -> None:
    """Idempotent : ne touche pas à ce qui existe déjà."""
    for model, libelles in ((Service, SERVICES), (Activite, ACTIVITES),
                            (TypeContrat, CONTRATS), (Site, SITES)):
        _fill(db, model, libelles)
    existantes = set(db.scalars(select(Rubrique.libelle)))
    for ordre, (lib, unite) in enumerate(RUBRIQUES, start=1):
        if lib not in existantes:
            db.add(Rubrique(libelle=lib, unite=unite, ordre=ordre))
    db.flush()
    rub = {r.libelle: r.id for r in db.scalars(select(Rubrique))}
    if not db.scalar(select(RubriqueRegle.id).limit(1)):
        db.add_all(
            RubriqueRegle(rubrique_id=rub[lib], regle="exclu_total_ligne", date_debut=DEBUT)
            for lib in EXCLUES_TOTAL_LIGNE
        )
    if not db.scalar(select(RefAlias.id).where(RefAlias.dimension == "rubrique")):
        db.add(RefAlias(dimension="rubrique", alias_norm="variable", cible_id=rub["Commission"]))
    if not db.scalar(select(Parametre.id).limit(1)):
        db.add_all(Parametre(cle=c, valeur=Decimal(v), date_debut=DEBUT)
                   for c, v in PARAMETRES_DEFAUT.items())
    db.flush()
