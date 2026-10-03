"""Modèles Excel téléchargeables (employés, données mensuelles)."""

import io

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

GRIS = PatternFill("solid", fgColor="D9D9D9")
EMPLOYES_ENTETES = ["Matricule", "Noms", "Poste", "Type Contrat", "Activité", "Site", "Service", "Actif"]


def entete(ws, ligne: int, titres: list[str]) -> None:
    for i, t in enumerate(titres, start=1):
        c = ws.cell(ligne, i, t)
        c.font, c.fill = Font(bold=True), GRIS
        c.alignment = Alignment(wrap_text=True, vertical="center")
        ws.column_dimensions[get_column_letter(i)].width = max(14, len(t) + 4)


def listes(wb: Workbook, colonnes: dict[str, list[str]]) -> dict[str, str]:
    """Feuille LISTES masquée : une colonne par référentiel, renvoie les plages pour validation."""
    ws = wb.create_sheet("LISTES")
    plages = {}
    for i, (nom, valeurs) in enumerate(colonnes.items(), start=1):
        ws.cell(1, i, nom).font = Font(bold=True)
        for j, v in enumerate(valeurs, start=2):
            ws.cell(j, i, v)
        lettre = get_column_letter(i)
        plages[nom] = f"=LISTES!${lettre}$2:${lettre}${max(2, len(valeurs) + 1)}"
    ws.sheet_state = "hidden"
    return plages


def liste_deroulante(ws, plage: str, colonne: int, premiere: int, derniere: int) -> None:
    dv = DataValidation(type="list", formula1=plage, allow_blank=True)
    ws.add_data_validation(dv)
    lettre = get_column_letter(colonne)
    dv.add(f"{lettre}{premiere}:{lettre}{derniere}")


def modele_employes(refs: dict[str, list[str]], exemples: list[list] | None = None) -> bytes:
    """refs : libellés par dimension (Poste, Type Contrat, Activité, Site, Service)."""
    wb = Workbook()
    ws = wb.active
    ws.title = "EMPLOYES"
    ws["A1"] = "Une ligne par employé. Matricule et Noms obligatoires ; les listes sont déroulantes."
    ws["A1"].font = Font(italic=True)
    entete(ws, 3, EMPLOYES_ENTETES)
    for i, row in enumerate(exemples or [], start=4):
        for j, v in enumerate(row, start=1):
            ws.cell(i, j, v)
    plages = listes(wb, {**refs, "Actif": ["Oui", "Non"]})
    for col, nom in ((3, "Poste"), (4, "Type Contrat"), (5, "Activité"), (6, "Site"), (7, "Service"),
                     (8, "Actif")):
        liste_deroulante(ws, plages[nom], col, 4, 500)
    ws.freeze_panes = "A4"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
