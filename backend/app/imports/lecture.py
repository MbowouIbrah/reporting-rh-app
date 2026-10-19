"""Lecture brute de la feuille DONNEES (aucune règle métier ici)."""

import io
import re
import unicodedata
from dataclasses import dataclass, field

from openpyxl import load_workbook

MAX_OCTETS = 20 * 1024 * 1024
MAX_LIGNES_VIDES = 50  # la plage déclarée d'un xlsx peut aller à 1 048 576 lignes
LIGNES_ENTETE = 10
MAX_LIGNES_APRES = 20_000  # recherche de données oubliées après l'arrêt de lecture
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
    ligne_ignoree: int | None = None  # 1re ligne remplie après MAX_LIGNES_VIDES lignes vides
    formules: dict[int, dict[int, str]] = field(default_factory=dict)  # ligne -> {position: formule}


# Valeurs d'erreur d'Excel (codes du fichier, et leur version française collée en texte).
RE_ERREUR_EXCEL = re.compile(r"^#(N/A|N/D|REF!|VALUE!|VALEUR!|DIV/0!|NAME\?|NOM\?|NUM!|NOMBRE!|NULL!|NUL!"
                             r"|SPILL!|CALC!|GETTING_DATA)$", re.IGNORECASE)


def erreur_excel(v) -> bool:
    return isinstance(v, str) and RE_ERREUR_EXCEL.match(v.strip()) is not None


def formule(v) -> bool:
    """Formule sans valeur calculée (fichier jamais enregistré par Excel) : la lecture garde son texte."""
    return isinstance(v, str) and v.startswith("=")


def cellule_vide(v) -> bool:
    return v is None or str(v).strip() == "" or erreur_excel(v) or formule(v)


def _fusion(r, rf) -> tuple[tuple, dict[int, str]]:
    """Valeur calculée par Excel ; à défaut, le texte de la formule. Formules gardées par position."""
    vals, fs = [], {}
    for j, (v, f) in enumerate(zip(r, rf, strict=False)):
        if formule(f):
            fs[j] = f
            if v is None:
                v = f
        vals.append(v)
    return tuple(vals), fs


def ligne_vide(row, utiles) -> bool:
    """Vide si aucune colonne utile n'est remplie : les formules prolongées sous les données
    (colonnes calculées seules, erreurs Excel, formules jamais calculées) ne comptent pas."""
    return all(j >= len(row) or cellule_vide(row[j]) for j in utiles)


def lire(contenu: bytes, reconnues: set[str] | None = None) -> Feuille:
    """reconnues : en-têtes normalisés qui décident si une ligne est vide (ceux que les règles
    lisent) ; par défaut toute colonne nommée non calculée."""
    if len(contenu) > MAX_OCTETS:
        raise FichierIllisible("Fichier trop volumineux (20 Mo maximum).")
    try:
        wb = load_workbook(io.BytesIO(contenu), read_only=True, data_only=True)
        wbf = load_workbook(io.BytesIO(contenu), read_only=True)  # formules, pour celles sans valeur
    except Exception as e:  # zip invalide, format inconnu
        raise FichierIllisible("Fichier xlsx illisible.") from e
    try:
        if "DONNEES" not in wb.sheetnames:
            raise FichierIllisible("Feuille DONNEES introuvable.")
        formules: dict[int, dict[int, str]] = {}

        def fusionnees():
            for n, (r, rf) in enumerate(zip(wb["DONNEES"].iter_rows(values_only=True),
                                            wbf["DONNEES"].iter_rows(values_only=True), strict=False), start=1):
                row, fs = _fusion(r, rf)
                if fs:
                    formules[n] = fs
                yield row

        it = fusionnees()
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
        utiles = [j for j, v in enumerate(entete) if v is not None and str(v).strip() != ""
                  and (norm(v) in reconnues if reconnues is not None else not calculee(norm(v)))]
        lignes, vides, num = [], 0, entete_ligne
        for num, row in enumerate(it, start=entete_ligne + 1):
            if ligne_vide(row, utiles):
                vides += 1
                if vides >= MAX_LIGNES_VIDES:
                    break
                continue
            vides = 0
            lignes.append((num, tuple(row)))
        ignoree = None
        if vides >= MAX_LIGNES_VIDES:  # données plus bas : signalées, jamais perdues en silence
            for k, row in enumerate(it, start=num + 1):
                if k > num + MAX_LIGNES_APRES:
                    break
                if not ligne_vide(row, utiles):
                    ignoree = k
                    break
        return Feuille(entete_ligne, entete, lignes, ignoree, {n: formules[n] for n, _ in lignes if n in formules})
    finally:
        wb.close()
        wbf.close()
