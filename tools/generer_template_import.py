"""Génère le template d'import des données RH (structure de la feuille DONNEES de la V5).

Usage : python tools/generer_template_import.py
Sortie : templates/TEMPLATE_IMPORT_DONNEES_v1.xlsx
Feuille DONNEES identique à celle de REPORTING_RH_V5.xlsx : titre ligne 1, consigne ligne 2,
en-têtes ligne 3, données à partir de la ligne 4.
"""
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.datavalidation import DataValidation

VERSION = "1.1"
LIGNES = 5000  # lignes pré-validées
ENTETE = 3  # comme la feuille DONNEES de l'Excel
TITRE = "FEUILLE DE DONNÉES CENTRALE — une ligne par employé et par mois"
CONSIGNE = ("Saisir ANNÉE (ex. 2025), MOIS (nom dans la liste) et MATRICULE (clé unique, ex. EMP001). "
            "Ajouter les nouveaux mois à la suite, sans ligne vide. "
            "Pas de colonne TOTAL : il est calculé par l'application.")

NAVY, RED, PAPER = "1A1F3C", "E3001B", "F4F5F8"

MOIS = ["Janvier", "Février", "Mars", "Avril", "Mai", "Juin", "Juillet",
        "Août", "Septembre", "Octobre", "Novembre", "Décembre"]
SERVICES = ["Commerce VN", "Commerce Pièces", "Administration", "SAV PL",
            "SAV Engins", "Sites Déportés", "Pneumatique"]
ACTIVITES = ["Front office", "Back Office"]
CONTRATS = ["CDI", "CDD", "MAD"]
SITES = ["Yaoundé", "Douala", "Bertoua", "Ngaoundéré", "Garoua", "Dehane",
         "Libongo", "Njombe", "Dimon", "Nkoteng"]

# (libellé, largeur, aide) — identifiants et attributs
ATTRIBUTS = [
    ("ANNÉE", 9, "Entier, ex. 2026"),
    ("MOIS", 12, "Nom du mois, liste déroulante"),
    ("MATRICULE", 14, "Texte, clé unique avec ANNÉE+MOIS (ex. EMP001)"),
    ("Noms", 26, "Texte"),
    ("Poste", 24, "Texte"),
    ("Type Contrat", 13, "CDI, CDD ou MAD"),
    ("Activité", 14, "Front office ou Back Office"),
    ("Site", 14, "Liste des sites"),
    ("Service", 17, "Liste des services"),
]
# rubriques numériques (ordre V5). Absences en jours, le reste en FCFA.
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

thin = Side(style="thin", color="D5D8E0")
BORD = Border(left=thin, right=thin, top=thin, bottom=thin)


def entete(cell, couleur=NAVY):
    cell.font = Font(bold=True, color="FFFFFF", name="Calibri")
    cell.fill = PatternFill("solid", fgColor=couleur)
    cell.alignment = Alignment(horizontal="center", vertical="center", wrap_text=True)
    cell.border = BORD


def feuille_lisez_moi(wb):
    ws = wb.active
    ws.title = "LISEZ-MOI"
    ws.sheet_view.showGridLines = False
    ws.column_dimensions["A"].width = 3
    ws.column_dimensions["B"].width = 34
    ws.column_dimensions["C"].width = 90
    ws["B2"] = "Template d'import des données RH"
    ws["B2"].font = Font(size=16, bold=True, color=NAVY)
    ws["B3"] = f"Version du template : {VERSION}"
    ws["B3"].font = Font(color=RED, bold=True)
    regles = [
        ("Feuille à remplir", "DONNEES uniquement. Ne pas renommer les feuilles ni les en-têtes, ne pas insérer, déplacer ou supprimer de colonne."),
        ("Granularité", "Une ligne par salarié et par mois. Clé unique : ANNÉE + MOIS + MATRICULE."),
        ("Début des données", "Ligne 4 de la feuille DONNEES (titre ligne 1, consigne ligne 2, en-têtes ligne 3), comme dans l'Excel REPORTING RH. Aucune ligne de total."),
        ("Lignes vides", "À éviter entre les données : après 50 lignes vides consécutives, le fichier est refusé tant qu'elles ne sont pas supprimées."),
        ("ANNÉE / MOIS", "ANNÉE : nombre entier (2026). MOIS : nom complet avec accent, issu de la liste (Février, Août, Décembre)."),
        ("MATRICULE", "Texte, sans espace en début ou fin. Conserver les zéros de tête (colonne au format texte)."),
        ("Listes", "Type Contrat, Activité, Site, Service : choisir dans la liste (feuille LISTES). Une valeur absente de la liste est rejetée à l'import. Toute nouvelle valeur doit d'abord être créée dans l'application."),
        ("Montants", "Nombre uniquement : pas de texte, pas d'unité, pas d'espace, pas de formule, pas de #N/A. Séparateur décimal selon le poste Excel. Cellule vide = 0. Les négatifs sont admis (régularisations)."),
        ("Absences (nb)", "Nombre de jours d'absence (pas un montant). Les autres rubriques sont en FCFA."),
        ("TOTAL CHARGES", "Absent du template : calculé par l'application. La feuille DONNEES de l'Excel REPORTING RH peut être importée telle quelle : ses colonnes calculées (TOTAL CHARGES, Total exclusions, colonnes « (norme) ») sont ignorées."),
        ("Commission", "Remplace l'ancienne colonne « Variable » de la V4."),
        ("Doublons", "Deux lignes avec la même clé ANNÉE + MOIS + MATRICULE bloquent l'import."),
        ("Contrôle à l'import", "Chaque anomalie est rapportée avec sa ligne et sa colonne. Rien n'est appliqué tant que le rapport n'a pas été validé. Un lot appliqué peut être annulé."),
        ("Après la ligne 5003", "Les validations de saisie couvrent 5 000 lignes. L'import lit toutes les lignes, au-delà aussi."),
    ]
    ws["B5"], ws["C5"] = "Règle", "Détail"
    entete(ws["B5"]), entete(ws["C5"])
    for i, (k, v) in enumerate(regles, start=6):
        ws.cell(i, 2, k).font = Font(bold=True, color=NAVY)
        ws.cell(i, 3, v).alignment = Alignment(wrap_text=True, vertical="top")
        ws.cell(i, 2).alignment = Alignment(vertical="top")
        for c in (2, 3):
            ws.cell(i, c).border = BORD
            if i % 2 == 0:
                ws.cell(i, c).fill = PatternFill("solid", fgColor=PAPER)


def feuille_donnees(wb):
    ws = wb.create_sheet("DONNEES")
    ws["A1"] = TITRE
    ws["A1"].font = Font(size=13, bold=True, color=NAVY)
    ws["A2"] = CONSIGNE
    ws["A2"].font = Font(italic=True)
    colonnes = [a[0] for a in ATTRIBUTS] + [r[0] for r in RUBRIQUES]
    for j, nom in enumerate(colonnes, start=1):
        c = ws.cell(ENTETE, j, nom)
        entete(c, NAVY if j <= len(ATTRIBUTS) else RED)
        larg = ATTRIBUTS[j - 1][1] if j <= len(ATTRIBUTS) else 16
        ws.column_dimensions[get_column_letter(j)].width = larg
    ws.row_dimensions[ENTETE].height = 34
    ws.freeze_panes = f"D{ENTETE + 1}"
    debut, fin = ENTETE + 1, ENTETE + LIGNES

    # formats : matricule en texte, montants en nombre
    nb_attr = len(ATTRIBUTS)
    for r in range(debut, fin + 1):
        ws.cell(r, 3).number_format = "@"
        for j in range(nb_attr + 1, len(colonnes) + 1):
            ws.cell(r, j).number_format = "#,##0.###;[Red]-#,##0.###"

    def liste(formule, col, titre):
        dv = DataValidation(type="list", formula1=formule, allow_blank=True,
                            showErrorMessage=True, errorTitle=titre,
                            error="Valeur absente de la liste (feuille LISTES).")
        dv.add(f"{col}{debut}:{col}{fin}")
        ws.add_data_validation(dv)

    liste("=REF_MOIS", "B", "Mois invalide")
    liste("=REF_CONTRATS", "F", "Type de contrat inconnu")
    liste("=REF_ACTIVITES", "G", "Activité inconnue")
    liste("=REF_SITES", "H", "Site inconnu")
    liste("=REF_SERVICES", "I", "Service inconnu")

    annee = DataValidation(type="whole", operator="between", formula1="2000", formula2="2100",
                           allow_blank=True, showErrorMessage=True,
                           errorTitle="Année invalide", error="Entier entre 2000 et 2100.")
    annee.add(f"A{debut}:A{fin}")
    ws.add_data_validation(annee)

    texte = DataValidation(type="custom", formula1=f"ISTEXT(C{debut})", allow_blank=True,
                           showErrorMessage=True, errorTitle="Matricule invalide",
                           error="Le matricule doit être du texte.")
    texte.add(f"C{debut}:C{fin}")
    ws.add_data_validation(texte)

    montant = DataValidation(type="decimal", operator="between", formula1="-1E+12", formula2="1E+12",
                             allow_blank=True, showErrorMessage=True,
                             errorTitle="Montant invalide", error="Nombre uniquement, sans texte.")
    montant.add(f"{get_column_letter(nb_attr + 1)}{debut}:{get_column_letter(len(colonnes))}{fin}")
    ws.add_data_validation(montant)

    # commentaires d'aide sur les en-têtes
    from openpyxl.comments import Comment
    aides = [a[2] for a in ATTRIBUTS] + [f"Unité : {r[1]}" for r in RUBRIQUES]
    for j, aide in enumerate(aides, start=1):
        ws.cell(ENTETE, j).comment = Comment(aide, "Template")
    return ws


def feuille_exemple(wb):
    ws = wb.create_sheet("EXEMPLE")
    colonnes = [a[0] for a in ATTRIBUTS] + [r[0] for r in RUBRIQUES]
    for j, nom in enumerate(colonnes, start=1):
        entete(ws.cell(1, j, nom), "6B7080")
        ws.column_dimensions[get_column_letter(j)].width = 16
    attr1 = [2026, "Janvier", "EMP001", "NOM Prénom", "Commercial VN", "CDI", "Front office", "Douala", "Commerce VN"]
    attr2 = [2026, "Janvier", "EMP002", "NOM Prénom", "Mécanicien", "CDD", "Back Office", "Yaoundé", "SAV PL"]
    m1 = {"Primes sur ventes": 150000, "Commission": 80000, "Salaire brut garantie": 250000,
          "Brut Réel": 450000, "Charges Patronales": 120000, "Assurance Maladie": 15000}
    m2 = {"Absences (nb)": 2, "Salaire brut garantie": 180000, "Logement site déporté": 30000,
          "Brut Réel": 320000, "Charges Patronales": 85000, "Assurance Maladie": 10000}
    lignes = [attr + [m.get(r[0], 0) for r in RUBRIQUES] for attr, m in ((attr1, m1), (attr2, m2))]
    for r, ligne in enumerate(lignes, start=2):
        for j, v in enumerate(ligne, start=1):
            ws.cell(r, j, v)
    ws["A5"] = "Feuille indicative : valeurs fictives, jamais importée."
    ws["A5"].font = Font(italic=True, color=RED)


def feuille_referentiels(wb):
    ws = wb.create_sheet("LISTES")
    blocs = [("MOIS", MOIS, "REF_MOIS"), ("TYPE CONTRAT", CONTRATS, "REF_CONTRATS"),
             ("ACTIVITÉ", ACTIVITES, "REF_ACTIVITES"), ("SITE", SITES, "REF_SITES"),
             ("SERVICE", SERVICES, "REF_SERVICES")]
    for j, (titre, valeurs, nom) in enumerate(blocs, start=1):
        entete(ws.cell(1, j, titre))
        ws.column_dimensions[get_column_letter(j)].width = 20
        for i, v in enumerate(valeurs, start=2):
            ws.cell(i, j, v).border = BORD
        col = get_column_letter(j)
        wb.defined_names[nom] = __import__("openpyxl").workbook.defined_name.DefinedName(
            nom, attr_text=f"LISTES!${col}$2:${col}${len(valeurs) + 1}")
    ws["H1"] = "Les listes sont modifiées dans l'application, pas dans ce fichier."
    ws["H1"].font = Font(italic=True, color=RED)


def main():
    wb = Workbook()
    feuille_lisez_moi(wb)
    feuille_donnees(wb)
    feuille_referentiels(wb)
    feuille_exemple(wb)
    wb.properties.title = f"Template import données RH v{VERSION}"
    sortie = Path(__file__).resolve().parent.parent / "templates" / f"TEMPLATE_IMPORT_DONNEES_v{VERSION.split('.')[0]}.xlsx"
    sortie.parent.mkdir(exist_ok=True)
    wb.save(sortie)
    print(sortie)


if __name__ == "__main__":
    main()
