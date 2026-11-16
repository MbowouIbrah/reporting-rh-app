"""Graphes d'évolution en classeur Excel modifiable (retours N2, point 2).

Une feuille par graphe : le tableau des données (mois, N, N-1, objectif) et un vrai graphique
Excel lié à ce tableau. Modifier une valeur met le graphique à jour ; copié dans PowerPoint, il
garde ses données (clic droit > Modifier les données). Construit à partir du rapport annuel déjà
filtré (périmètre, droits) : un graphe sans aucune donnée n'a pas de feuille.
"""

from collections.abc import Callable

from openpyxl import Workbook
from openpyxl.chart import BarChart, LineChart, Reference
from openpyxl.styles import Font

from app.exports.xlsx import _sortie, _val

MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août",
               "sept.", "oct.", "nov.", "déc."]


def _act(cle: str) -> Callable[[dict], object]:
    return lambda m: (m.get("activite") or {}).get(cle)


def _champ(cle: str) -> Callable[[dict], object]:
    return lambda m: m.get(cle)


# (titre de la feuille, titre du graphe, valeur du mois, clé d'objectif ou None, en courbe)
GRAPHES: list[tuple[str, str, Callable[[dict], object], str | None, bool]] = [
    ("Masse salariale", "Masse salariale mensuelle (FCFA)", _champ("ms"), "ms", False),
    ("Frais de mission", "Frais de mission (FCFA)", _champ("frais_mission"), "frais_mission",
     False),
    ("Rémunération", "Rémunération globale (FCFA)", _champ("remuneration"), "remuneration", False),
    ("Salaire", "Salaire par mois (FCFA)", _champ("salaire"), None, False),
    ("Primes", "Primes par mois (FCFA)", _champ("primes_toutes"), None, False),
    ("Ventes", "Ventes par mois", _act("ventes"), "ventes", False),
    ("Clients", "Clients par mois", _act("clients"), "clients", False),
    ("OR par productif", "OR par productif et par mois", _act("or_par_productif"), None, False),
    ("CA", "CA par mois (FCFA)", _champ("ca"), "ca", False),
    ("Marge", "Marge par mois (FCFA)", _champ("marge"), "marge", False),
    ("Commissions", "Commissions par mois (FCFA)", _champ("commissions"), "commissions", False),
    ("Productivité", "Productivité par mois", _act("productivite"), "productivite", True),
    ("Factures", "Factures par mois", _act("factures"), "factures", False),
    ("Absences", "Absences par mois (jours)", _champ("absences"), None, False),
    ("Assurance", "Assurance par mois (FCFA)", _champ("assurance"), None, False),
    ("Formation", "Formation par mois (FCFA)", _champ("formation"), None, False),
    ("Logement", "Logement site déporté par mois (FCFA)", _champ("logement"), None, False),
    ("Téléphone", "Crédit téléphonique par mois (FCFA)", _champ("credit_telephonique"), None,
     False),
    ("Carburant", "Carburant par mois (FCFA)", _champ("carburant"), None, False),
]


def _nombre(v):
    """Valeur numérique du graphe ; 'n/a' ou texte -> case vide."""
    v = _val(v)
    return None if isinstance(v, str) else v


def _rempli(colonne: list) -> bool:
    return any(v not in (None, 0) for v in colonne)


def _feuille(wb: Workbook, nom: str, titre: str, mois: list[str],
             colonnes: list[tuple[str, list]], courbe: bool, objectif: str | None) -> None:
    ws = wb.create_sheet(nom[:31])
    ws.append(["Mois"] + [e for e, _ in colonnes])
    for c in ws[1]:
        c.font = Font(bold=True)
    for i, m in enumerate(mois):
        ws.append([m] + [col[i] for _, col in colonnes])
    ws.column_dimensions["A"].width = 10
    for i in range(2, len(colonnes) + 2):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = 16
    n = len(mois) + 1
    cats = Reference(ws, min_col=1, min_row=2, max_row=n)
    # Séries comparées (N, N-1) en barres, sauf graphe en courbe ; l'objectif toujours en courbe.
    nb_series = len(colonnes) - (1 if objectif else 0)
    principal = LineChart() if courbe else BarChart()
    principal.add_data(Reference(ws, min_col=2, max_col=1 + nb_series, min_row=1, max_row=n),
                       titles_from_data=True)
    principal.set_categories(cats)
    if objectif:
        ligne = LineChart()
        ligne.add_data(Reference(ws, min_col=2 + nb_series, min_row=1, max_row=n),
                       titles_from_data=True)
        ligne.set_categories(cats)
        principal += ligne
    principal.title = titre
    principal.width, principal.height = 24, 12
    principal.legend.position = "b"
    ws.add_chart(principal, f"{ws.cell(1, len(colonnes) + 3).column_letter}2")


def graphiques(r: dict, nom_n: str, nom_n1: str) -> bytes:
    serie_n = r.get("serie_n") or []
    serie_n1 = r.get("serie_n1") or []
    mois = [MOIS_COURTS[(m["mois"] - 1) % 12] for m in serie_n]
    wb = Workbook()

    # Effectif : une courbe par type de contrat, comme à l'écran.
    contrats = [c["contrat"] for c in (r.get("d_contrat") or {}).get("effectifs", [])]
    eff = [("Effectif total", [m.get("effectif") for m in serie_n])]
    eff += [(c, [(m.get("effectif_contrat") or {}).get(c) for m in serie_n]) for c in contrats]
    if any(_rempli(col) for _, col in eff):
        _feuille(wb, "Effectif", "Effectif", mois, eff, True, None)

    for nom, titre, lire, cle_obj, courbe in GRAPHES:
        n = [_nombre(lire(m)) for m in serie_n]
        n1 = [_nombre(lire(serie_n1[i])) if i < len(serie_n1) else None
              for i in range(len(serie_n))]
        if not (_rempli(n) or _rempli(n1)):
            continue
        colonnes = [(nom_n, n)]
        if _rempli(n1):
            colonnes.append((nom_n1, n1))
        obj = [_nombre((m.get("objectifs") or {}).get(cle_obj)) for m in serie_n] if cle_obj else []
        avec_obj = _rempli(obj)
        if avec_obj:
            colonnes.append(("Objectif", obj))
        _feuille(wb, nom, titre, mois, colonnes, courbe, "Objectif" if avec_obj else None)

    if len(wb.sheetnames) == 1:
        wb.create_sheet("Graphes").append(["Aucune donnée sur la période choisie."])
    return _sortie(wb)
