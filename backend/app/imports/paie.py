"""Export de paie (CSV) : lu puis ramené aux colonnes de l'application, pour passer par les mêmes contrôles."""

import csv
import io
import re
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.imports.lecture import MAX_OCTETS, Feuille, FichierIllisible, norm
from app.imports.regles import MOIS, nombre, texte
from app.models.referentiel import CorrespondancePaie, Rubrique

RE_NOM_FICHIER = re.compile(r"brutfinal(\d{2})(\d{2})(?!\d)", re.IGNORECASE)

# Colonnes de la paie qui décrivent l'employé : en-tête normalisé -> libellé affiché dans les messages.
SOURCES = {"matricule": "Matricule", "nom": "Nom", "prenom": "Prénom", "emploi occupe": "Emploi occupé",
           "nature du contrat": "Nature du contrat", "intitule etablissement": "Intitulé établissement",
           "intitule service": "Intitulé service"}
# Colonne facultative : département de la ligne, retenu pour rattacher un service créé par l'import.
DEPARTEMENT = "intitule departement"
# En-têtes de la feuille ramenée aux colonnes de l'application (avant les rubriques).
ENTETES = ["ANNÉE", "MOIS", "MATRICULE", "Noms", "Poste", "Type Contrat", "Activité", "Site", "Service"]


def est_csv(nom: str | None) -> bool:
    return (nom or "").lower().endswith(".csv")


def mois_du_nom(nom_fichier: str | None) -> tuple[int, int] | None:
    """(année, mois) lus dans un nom `BrutFinalMMAA` (BrutFinal1026.CSV -> (2026, 10)) ; None si illisible."""
    base = re.split(r"[\\/]", nom_fichier or "")[-1]
    m = RE_NOM_FICHIER.match(base)
    if m is None:
        return None
    mois, aa = int(m[1]), int(m[2])
    return (2000 + aa, mois) if 1 <= mois <= 12 else None


def correspondance(db: Session) -> dict[str, str]:
    """Colonne de paie (normalisée) -> libellé de la rubrique où elle est additionnée."""
    return {c.colonne_norm: lib for c, lib in db.execute(
        select(CorrespondancePaie, Rubrique.libelle).join(Rubrique, Rubrique.id == CorrespondancePaie.rubrique_id))}


def _decoder(contenu: bytes) -> str:
    try:
        return contenu.decode("utf-8-sig")
    except UnicodeDecodeError:
        return contenu.decode("latin-1")


def _cellule(row: list[str], j: int | None) -> str:
    return texte(row[j]) or "" if j is not None and j < len(row) else ""


def lire_csv(contenu: bytes, rubriques: list[str], liens: dict[str, str], annee: int, mois: int) -> Feuille:
    """CSV de paie (séparateur « ; », en-têtes ligne 1, UTF-8 puis Latin-1) -> feuille aux colonnes de l'appli.

    `rubriques` : rubriques de paie de l'application (une colonne chacune) ; `liens` : colonne de paie
    normalisée -> rubrique. Chaque rubrique additionne ses colonnes (Decimal, sans arrondi) ; une cellule vide
    compte pour 0, toutes vides : pas de montant. Les colonnes sans lien sont ignorées."""
    if len(contenu) > MAX_OCTETS:
        raise FichierIllisible("Fichier trop volumineux (20 Mo maximum).")
    lecteur = csv.reader(io.StringIO(_decoder(contenu), newline=""), delimiter=";")
    entete: list[str] | None = None
    lignes: list[tuple[int, list[str]]] = []
    try:
        for row in lecteur:
            if entete is None:
                entete = row
            elif any(c.strip() for c in row):
                lignes.append((lecteur.line_num, row))
    except csv.Error as e:
        raise FichierIllisible("Fichier CSV illisible.") from e
    if not entete:
        raise FichierIllisible("Fichier CSV vide.")
    # Première colonne portant chaque nom : une colonne en double n'est pas additionnée deux fois.
    position: dict[str, int] = {}
    for j, h in enumerate(entete):
        position.setdefault(norm(h), j)
    manquantes = [lib for cle, lib in SOURCES.items() if cle not in position]
    if manquantes:
        raise FichierIllisible("Ce fichier ne ressemble pas à un export de paie : colonne(s) absente(s) : "
                               + ", ".join(manquantes) + ".")
    par_rubrique: dict[str, list[int]] = {r: [] for r in rubriques}
    for cle, rub in liens.items():
        if rub in par_rubrique and cle in position:
            par_rubrique[rub].append(position[cle])

    def montant(row: list[str], cols: list[int]):
        total, vu = Decimal(0), False
        for j in cols:
            brut = _cellule(row, j)
            if not brut:
                continue
            r = nombre(brut)
            if r is None:
                return brut  # texte gardé tel quel : le contrôle du montant le signale sur la ligne
            total += r[0]
            vu = True
        return total if vu else None

    sortie = []
    departements: dict[str, str] = {}
    for num, row in lignes:
        v = {cle: _cellule(row, j) for cle, j in position.items() if cle in SOURCES}
        noms = " ".join(x for x in (v["nom"], v["prenom"]) if x)
        dep = _cellule(row, position.get(DEPARTEMENT))
        if dep and v["intitule service"]:
            departements.setdefault(norm(v["intitule service"]), dep)
        sortie.append((num, (
            annee, MOIS[mois - 1], v["matricule"] or None, noms or None, v["emploi occupe"] or None,
            v["nature du contrat"] or None, None, v["intitule etablissement"] or None,
            v["intitule service"] or None, *(montant(row, par_rubrique[r]) for r in rubriques))))
    return Feuille(1, [*ENTETES, *rubriques], sortie, None, {}, departements)
