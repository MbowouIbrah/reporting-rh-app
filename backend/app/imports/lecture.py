"""Lecture brute de la feuille DONNEES (aucune règle métier ici)."""

import io
import re
import unicodedata
from dataclasses import dataclass

from openpyxl import load_workbook

MAX_OCTETS = 20 * 1024 * 1024
MAX_LIGNES_VIDES = 50  # la plage déclarée d'un xlsx peut aller à 1 048 576 lignes
LIGNES_ENTETE = 10
CLES_ENTETE = ("annee", "mois", "matricule")


class FichierIllisible(ValueError):
    pass


def norm(v) -> str:
    """Texte comparable : sans NBSP/espaces multiples, sans accents, minuscule."""
    s = unicodedata.normalize("NFKD", str(v).replace(" ", " ").strip())
    s = "".join(c for c in s if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", s).casefold()


# Colonnes calculées de la feuille DONNEES de l'Excel REPORTING RH.
CALCULEES = {norm("TOTAL CHARGES (FCFA)"), norm("Total exclusions (technique)")}


def calculee(n: str) -> bool:
    """En-tête normalisé d'une colonne calculée de la feuille DONNEES de l'Excel REPORTING RH
    (ignorée sans avertissement à l'import)."""
    return n in CALCULEES or n.endswith("(norme)")


@dataclass
class Feuille:
    entete_ligne: int
    entetes: list  # valeurs brutes de la ligne d'en-tête, par position réelle
    lignes: list[tuple[int, tuple]]  # (numéro de ligne Excel, valeurs)


def _vide(row, utiles) -> bool:
    """Vide si aucune colonne utile n'est remplie : les formules prolongées sous les données
    (colonnes calculées seules) ne comptent pas."""
    return all(j >= len(row) or row[j] is None or str(row[j]).strip() == "" for j in utiles)


def lire(contenu: bytes) -> Feuille:
    if len(contenu) > MAX_OCTETS:
        raise FichierIllisible("Fichier trop volumineux (20 Mo maximum).")
    try:
        wb = load_workbook(io.BytesIO(contenu), read_only=True, data_only=True)
    except Exception as e:  # zip invalide, format inconnu
        raise FichierIllisible("Fichier xlsx illisible.") from e
    try:
        if "DONNEES" not in wb.sheetnames:
            raise FichierIllisible("Feuille DONNEES introuvable.")
        it = wb["DONNEES"].iter_rows(values_only=True)
        entete, entete_ligne = None, 0
        for num, row in enumerate(it, start=1):
            if num > LIGNES_ENTETE:
                break
            normes = {norm(v) for v in row if v is not None}
            if all(c in normes for c in CLES_ENTETE):
                entete, entete_ligne = list(row), num
                break
        if entete is None:
            raise FichierIllisible("En-tête introuvable (ANNÉE, MOIS, MATRICULE) dans les 10 premières lignes.")
        utiles = [j for j, v in enumerate(entete)
                  if v is not None and str(v).strip() != "" and not calculee(norm(v))]
        lignes, vides = [], 0
        for num, row in enumerate(it, start=entete_ligne + 1):
            if _vide(row, utiles):
                vides += 1
                if vides >= MAX_LIGNES_VIDES:
                    break
                continue
            vides = 0
            lignes.append((num, tuple(row)))
        return Feuille(entete_ligne, entete, lignes)
    finally:
        wb.close()
