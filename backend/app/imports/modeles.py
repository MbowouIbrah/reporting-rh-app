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


def filtre(ws, ligne: int, nb_colonnes: int, derniere: int) -> None:
    """Flèches de filtre et tri sur l'en-tête, étendues aux lignes à remplir."""
    ws.auto_filter.ref = f"A{ligne}:{get_column_letter(nb_colonnes)}{max(derniere, ligne + 1)}"


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
    filtre(ws, 3, len(EMPLOYES_ENTETES), 500)
    ws.freeze_panes = "A4"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def modele_mensuel(annee: int, mois: int, rubriques: list[str], refs: dict[str, list[str]],
                   lignes: list[list]) -> bytes:
    """Feuille DONNEES identique à celle de l'Excel REPORTING RH : titre ligne 1, consigne ligne 2,
    en-tête ligne 3, rubriques dans l'ordre de l'Excel (pas l'ordre d'affichage de l'application).

    lignes : [matricule, nom, poste, contrat, activité, site, service, *montants (rubriques)].
    """
    from app.imports.regles import ATTRIBUTS, MOIS
    from app.referentiels_init import RUBRIQUES

    rang = {lib: i for i, (lib, _u) in enumerate(RUBRIQUES)}
    ordre = sorted(range(len(rubriques)), key=lambda i: (rang.get(rubriques[i], len(rang)), i))
    rubriques = [rubriques[i] for i in ordre]

    wb = Workbook()
    ws = wb.active
    ws.title = "DONNEES"
    ws["A1"] = "FEUILLE DE DONNÉES CENTRALE — une ligne par employé et par mois"
    ws["A1"].font = Font(bold=True, size=13)
    ws["A2"] = (f"Données de {MOIS[mois - 1]} {annee}. Saisir ANNÉE (ex. 2025), MOIS (nom dans la "
                "liste) et MATRICULE (clé unique, ex. EMP001). Cellule vide = pas de montant. Importer "
                "ensuite ce fichier dans Administration > Données mensuelles.")
    ws["A2"].font = Font(italic=True)
    entete(ws, 3, ATTRIBUTS + rubriques)
    for i, ligne in enumerate(lignes, start=4):
        mat, nom, poste, contrat, activite, site, service, *montants = ligne
        valeurs = [annee, MOIS[mois - 1], mat, nom, poste, contrat, activite, site, service,
                   *(montants[k] for k in ordre)]
        for j, v in enumerate(valeurs, start=1):
            c = ws.cell(i, j, v)
            if j > len(ATTRIBUTS):
                c.number_format = "#,##0.###"
    plages = listes(wb, refs)
    derniere = max(500, len(lignes) + 3)
    for col, nom in ((5, "Poste"), (6, "Type Contrat"), (7, "Activité"), (8, "Site"), (9, "Service")):
        liste_deroulante(ws, plages[nom], col, 4, derniere)
    filtre(ws, 3, len(ATTRIBUTS) + len(rubriques), derniere)
    ws.freeze_panes = "E4"
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()
