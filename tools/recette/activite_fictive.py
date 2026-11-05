"""Données d'activité fictives (ventes, clients, indice de productivité, CA et marge individuels).

Valeurs déterministes, calculées depuis le matricule et le mois : mêmes données à chaque passage.
- Front office (hors Administration) : ventes, clients, CA et marge individuels.
- SAV PL et SAV Engins back office (productifs) : indice de productivité.
- Cas limites : un vendeur sans CA (ventes seules), une marge négative, un CA avec décimales.

Usage seul (ajoute les colonnes à un fichier d'import, feuille DONNEES, en-tête ligne 3) :
    python tools/recette/activite_fictive.py <source.xlsx> <sortie.xlsx>
reinit.py l'appelle pour l'historique de recette.
"""

import sys
from pathlib import Path

VENTES, CLIENTS, PRODUCTIVITE = "Nombre de ventes", "Nombre de clients", "Indice de productivité"
CA, MARGE = "CA individuel", "Marge individuelle"
COLONNES = [VENTES, CLIENTS, PRODUCTIVITE, CA, MARGE]
MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet", "Août",
        "Septembre", "Octobre", "Novembre", "Décembre"]


def valeurs(matricule: str, mois: int, service: str, activite: str) -> dict:
    """Colonnes d'activité d'une ligne ; dictionnaire vide si l'employé n'en a pas."""
    n = int("".join(c for c in str(matricule) if c.isdigit()) or 0)
    activite = (activite or "").strip().lower()
    if activite == "front office" and service != "Administration":
        ventes = 4 + (n * 3 + mois) % 9
        v = {VENTES: ventes, CLIENTS: max(1, ventes - n % 3)}
        if n % 7 == 3:
            return v  # vendeur sans CA renseigné
        ca = ventes * (850_000 + n * 12_500)
        marge = round(ca * (0.12 + (n % 5) / 100))
        if n % 11 == 4 and mois == 3:
            marge = -150_000  # marge négative
        if n % 9 == 1 and mois == 6:
            ca += 0.5  # décimales gardées telles quelles
        return {**v, CA: ca, MARGE: marge}
    if activite == "back office" and service in ("SAV PL", "SAV Engins"):
        return {PRODUCTIVITE: round(0.85 + ((n + mois) % 30) / 100, 2)}
    return {}


def _num(m) -> int:
    return MOIS.index(str(m).replace("\xa0", " ").strip().capitalize()) + 1


def ajouter(entetes: list, lignes: list[list]) -> tuple[list, list[list]]:
    """Ajoute les colonnes d'activité absentes à l'en-tête et remplit chaque ligne."""
    col = {h: i for i, h in enumerate(entetes)}
    nouvelles = [c for c in COLONNES if c not in col]
    entetes = list(entetes) + nouvelles
    col = {h: i for i, h in enumerate(entetes)}
    sortie = []
    for r in lignes:
        r = list(r) + [None] * (len(entetes) - len(r))
        v = valeurs(r[col["MATRICULE"]], _num(r[col["MOIS"]]),
                    r[col["Service"]], r[col["Activité"]])
        for c, x in v.items():
            r[col[c]] = x
        sortie.append(r)
    return entetes, sortie


def enrichir_fichier(source: Path, sortie: Path) -> int:
    import openpyxl

    wb = openpyxl.load_workbook(source)
    ws = wb["DONNEES"]
    entetes = [c.value for c in ws[3]]
    while entetes and entetes[-1] is None:
        entetes.pop()
    lignes = [list(r[:len(entetes)]) for r in ws.iter_rows(min_row=4, values_only=True) if r[2]]
    entetes, lignes = ajouter(entetes, lignes)
    for i, h in enumerate(entetes, start=1):
        ws.cell(3, i, h)
    for n, r in enumerate(lignes, start=4):
        for i, v in enumerate(r, start=1):
            ws.cell(n, i, v)
    wb.save(sortie)
    return len(lignes)


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    nb = enrichir_fichier(Path(sys.argv[1]), Path(sys.argv[2]))
    print(f"{nb} lignes, colonnes d'activité ajoutées : {sys.argv[2]}")
