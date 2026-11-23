"""Graphes d'évolution en classeur Excel modifiable (retours N2, point 2).

Une feuille par graphe : le tableau des données (mois, N, N-1, objectif) et un vrai graphique
Excel lié à ce tableau. Modifier une valeur met le graphique à jour ; copié dans PowerPoint, il
garde ses données (clic droit > Modifier les données). Construit à partir du rapport annuel déjà
filtré (périmètre, droits) : un graphe sans aucune donnée n'a pas de feuille.
"""

from collections.abc import Callable

from openpyxl import Workbook
from openpyxl.chart import AreaChart, BarChart, LineChart, Reference
from openpyxl.chart.axis import ChartLines
from openpyxl.chart.data_source import NumFmt
from openpyxl.chart.label import DataLabelList
from openpyxl.chart.legend import LegendEntry
from openpyxl.chart.shapes import GraphicalProperties
from openpyxl.chart.text import RichText, Text
from openpyxl.chart.title import Title
from openpyxl.drawing.line import LineProperties
from openpyxl.drawing.text import (
    CharacterProperties,
    Paragraph,
    ParagraphProperties,
    RegularTextRun,
)
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side

from app.exports.xlsx import _sortie, _val

MOIS_COURTS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août",
               "sept.", "oct.", "nov.", "déc."]

# Couleurs des jetons de l'application (frontend `styles/tokens.css`), mêmes rôles qu'à l'écran.
DATA = {1: "3B5BDB", 2: "0C8599", 3: "E8590C", 4: "7048E8", 5: "2F9E44", 6: "6B7280"}
ROUGE, ENCRE, GRIS, GRIS_N1 = "E3001B", "0E1126", "6B6F82", "9499AB"
TRAIT, NUIT, PAPIER_2 = "E7E7EA", "1A1F3C", "FAFAFA"
PT = 12700  # EMU par point

# Formats (axe, cellule) : axe des montants en millions (« 0,5 M », « 45 M »), comme à l'écran.
FORMATS = {
    "fcfa": ('[>=10000000]#,##0,," M";[>=1000000]0.0,," M";0.00,," M"', "#,##0"),
    "entier": ("#,##0", "#,##0"),
    "decimal": ("#,##0.0#", "#,##0.00"),
}


def _act(cle: str) -> Callable[[dict], object]:
    return lambda m: (m.get("activite") or {}).get(cle)


def _champ(cle: str) -> Callable[[dict], object]:
    return lambda m: m.get(cle)


# Dans l'ordre du catalogue à l'écran (`lib/groupesGraphes.ts`), chaque graphe avec le tracé de
# `pages/Graphes.tsx` : id écran, feuille, titre, valeur du mois, clé d'objectif, forme
# (aire / barres / courbe), teinte `--data-n`, N-1 (« tirets » : pointillés sans points ;
# « points » : trait plein à points), unité.
GRAPHES: list[tuple] = [
    ("ms", "Masse salariale", "Masse salariale mensuelle (FCFA)", _champ("ms"), "ms", "aire", 1,
     "tirets", "fcfa"),
    ("effectif", "Effectif", "Effectif", None, None, "courbe", 1, "", "entier"),
    ("frais", "Frais de mission", "Frais de mission (FCFA)", _champ("frais_mission"),
     "frais_mission", "barres", 4, "points", "fcfa"),
    ("remu", "Rémunération", "Rémunération globale (FCFA)", _champ("remuneration"), "remuneration",
     "aire", 5, "tirets", "fcfa"),
    ("salaire", "Salaire", "Salaire par mois (FCFA)", _champ("salaire"), None, "barres", 2,
     "tirets", "fcfa"),
    ("primes", "Primes", "Primes par mois (FCFA)", _champ("primes_toutes"), None, "barres", 3,
     "tirets", "fcfa"),
    ("ventes", "Ventes", "Ventes par mois", _act("ventes"), "ventes", "barres", 2, "points",
     "entier"),
    ("clients", "Clients", "Clients par mois", _act("clients"), "clients", "courbe", 3, "tirets",
     "entier"),
    ("or", "OR par productif", "OR par productif et par mois", _act("or_par_productif"), None,
     "aire", 1, "tirets", "decimal"),
    ("ca", "CA", "CA par mois (FCFA)", _champ("ca"), "ca", "barres", 1, "tirets", "fcfa"),
    ("marge", "Marge", "Marge par mois (FCFA)", _champ("marge"), "marge", "barres", 5, "tirets",
     "fcfa"),
    ("commissions", "Commissions", "Commissions par mois (FCFA)", _champ("commissions"),
     "commissions", "barres", 3, "tirets", "fcfa"),
    ("productivite", "Productivité", "Productivité par mois", _act("productivite"), "productivite",
     "courbe", 2, "tirets", "decimal"),
    ("factures", "Factures", "Factures par mois", _act("factures"), "factures", "barres", 4,
     "tirets", "entier"),
    ("absences", "Absences", "Absences par mois (jours)", _champ("absences"), None, "barres", 6,
     "tirets", "decimal"),
    ("assurance", "Assurance", "Assurance par mois (FCFA)", _champ("assurance"), None, "barres", 1,
     "tirets", "fcfa"),
    ("formation", "Formation", "Formation par mois (FCFA)", _champ("formation"), None, "barres", 1,
     "tirets", "fcfa"),
    ("logement", "Logement", "Logement site déporté par mois (FCFA)", _champ("logement"), None,
     "barres", 1, "tirets", "fcfa"),
    ("credit", "Téléphone", "Crédit téléphonique par mois (FCFA)", _champ("credit_telephonique"),
     None, "barres", 1, "tirets", "fcfa"),
    ("carburant", "Carburant", "Carburant par mois (FCFA)", _champ("carburant"), None, "barres", 1,
     "tirets", "fcfa"),
]

# Identifiant du graphe à l'écran → feuille du classeur.
IDS_ECRAN = {g[0]: g[1] for g in GRAPHES}


def _nombre(v):
    """Valeur numérique du graphe ; 'n/a' ou texte -> case vide."""
    v = _val(v)
    return None if isinstance(v, str) else v


def _rempli(colonne: list) -> bool:
    return any(v not in (None, 0) for v in colonne)


def _clair(hexa: str, part: float = 0.15) -> str:
    """Teinte posée sur fond blanc à `part` d'opacité (aire à 15 % à l'écran)."""
    return "".join(f"{round(255 - (255 - int(hexa[i:i + 2], 16)) * part):02X}" for i in (0, 2, 4))


def _texte(taille: int, couleur: str, gras: bool = False) -> CharacterProperties:
    return CharacterProperties(sz=taille, b=gras, solidFill=couleur)


def _riche(taille: int, couleur: str) -> RichText:
    cp = _texte(taille, couleur)
    return RichText(p=[Paragraph(pPr=ParagraphProperties(defRPr=cp), endParaRPr=cp)])


def _trait(couleur: str | None, epaisseur: float = 0, tirets: bool = False) -> GraphicalProperties:
    if couleur is None:
        return GraphicalProperties(ln=LineProperties(noFill=True))
    return GraphicalProperties(ln=LineProperties(solidFill=couleur, w=int(epaisseur * PT),
                                                 prstDash="dash" if tirets else None))


def _serie_trait(s, couleur: str, epaisseur: float, tirets: bool = False, points: bool = False,
                 rayon: int = 5) -> None:
    s.graphicalProperties = _trait(couleur, epaisseur, tirets)
    s.smooth = False
    s.marker.symbol = "circle" if points else "none"
    if points:
        s.marker.size = rayon
        s.marker.graphicalProperties = GraphicalProperties(
            solidFill=couleur, ln=LineProperties(solidFill=couleur))


def _habiller(g, titre: str, format_axe: str) -> None:
    """Habillage de la carte à l'écran : titre gras, grille horizontale claire, axes sans trait,
    graduations grises, légende en bas, axe des valeurs à partir de 0."""
    cp = _texte(1200, ENCRE, gras=True)
    g.title = Title(tx=Text(rich=RichText(p=[Paragraph(pPr=ParagraphProperties(defRPr=cp),
                                                       r=[RegularTextRun(rPr=cp, t=titre)])])),
                    overlay=False)
    g.width = 22
    g.legend.position = "t"
    g.legend.overlay = False
    g.legend.txPr = _riche(900, GRIS)
    g.graphical_properties = GraphicalProperties(ln=LineProperties(solidFill=TRAIT, w=PT))
    for axe in (g.x_axis, g.y_axis):
        axe.delete = False  # openpyxl 3.1 masque les axes par défaut
        axe.majorTickMark = axe.minorTickMark = "none"
        axe.spPr = _trait(None)
        axe.txPr = _riche(900, GRIS)
    g.x_axis.majorGridlines = None
    g.y_axis.majorGridlines = ChartLines(spPr=_trait(TRAIT, 0.75))
    g.y_axis.scaling.min = 0
    g.y_axis.numFmt = NumFmt(formatCode=format_axe, sourceLinked=False)


ENTETE = 5  # ligne des intitulés du tableau ; le graphe s'aligne dessus
LIGNE_PT = 24  # hauteur des lignes du tableau (points)
UNITES = {"fcfa": "Montants en FCFA", "entier": "Nombres", "decimal": "Valeurs"}


def _tableau(ws, titre: str, sous_titre: str, mois: list[str], colonnes: list[tuple[str, list]],
             format_cellule: str) -> None:
    """En-tête de page (repère rouge, titre, sous-titre) puis tableau : intitulés sur fond
    bleu nuit, lignes alternées, filets clairs, chiffres alignés à droite."""
    ws.sheet_view.showGridLines = False
    ws["A1"] = "REPORTING RH"
    ws["A1"].font = Font(bold=True, size=9, color=ROUGE)
    ws["A2"] = titre
    ws["A2"].font = Font(bold=True, size=16, color=ENCRE)
    ws["A3"] = sous_titre
    ws["A3"].font = Font(size=10, color=GRIS)
    ws.row_dimensions[2].height = 26
    filet = Side(style="thin", color=TRAIT)
    entetes = ["Mois"] + [e for e, _ in colonnes]
    for j, v in enumerate(entetes, start=1):
        c = ws.cell(ENTETE, j, v)
        c.font = Font(bold=True, color="FFFFFF")
        c.fill = PatternFill("solid", fgColor=NUIT)
        c.alignment = Alignment(horizontal="left" if j == 1 else "right", vertical="center",
                                indent=1)
    ws.row_dimensions[ENTETE].height = LIGNE_PT
    for i, m in enumerate(mois):
        ligne = ENTETE + 1 + i
        ws.row_dimensions[ligne].height = LIGNE_PT
        for j, v in enumerate([m] + [col[i] for _, col in colonnes], start=1):
            c = ws.cell(ligne, j, v)
            c.font = Font(color=ENCRE, bold=j == 1)
            c.border = Border(bottom=filet)
            c.alignment = Alignment(horizontal="left" if j == 1 else "right", vertical="center",
                                    indent=1)
            if i % 2:
                c.fill = PatternFill("solid", fgColor=PAPIER_2)
            if j > 1:
                c.number_format = format_cellule
    ws.column_dimensions["A"].width = 11
    for j in range(2, len(entetes) + 1):
        ws.column_dimensions[ws.cell(1, j).column_letter].width = 16
    ws.column_dimensions[ws.cell(1, len(entetes) + 1).column_letter].width = 3
    # Impression : tableau et graphe sur une seule page paysage
    ws.page_setup.orientation = "landscape"
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_setup.fitToWidth = ws.page_setup.fitToHeight = 1


def _poser(ws, g, nb_mois: int, nb_colonnes: int) -> None:
    """Graphe à droite du tableau, haut aligné sur les intitulés, même hauteur que le tableau."""
    g.height = (nb_mois + 1) * LIGNE_PT * 2.54 / 72
    ws.add_chart(g, f"{ws.cell(1, nb_colonnes + 3).column_letter}{ENTETE}")


def _sous_titre(unite: str, colonnes: list[tuple[str, list]], avec_n1: bool, avec_obj: bool) -> str:
    morceaux = [UNITES[unite], f"Année {colonnes[0][0]}"]
    if avec_n1:
        morceaux[-1] += f" comparée à {colonnes[1][0]}"
    if avec_obj:
        morceaux.append("objectif mensuel")
    return " · ".join(morceaux)


def _feuille(wb: Workbook, spec: tuple, mois: list[str], colonnes: list[tuple[str, list]],
             avec_n1: bool, avec_obj: bool) -> None:
    _, nom, titre, _, _, forme, teinte, style_n1, unite = spec
    ws = wb.create_sheet(nom[:31])
    format_axe, format_cellule = FORMATS[unite]
    _tableau(ws, nom, _sous_titre(unite, colonnes, avec_n1, avec_obj), mois, colonnes,
             format_cellule)
    n = ENTETE + len(mois)
    cats = Reference(ws, min_col=1, min_row=ENTETE + 1, max_row=n)
    couleur = DATA[teinte]

    def col(i: int) -> Reference:
        return Reference(ws, min_col=i, min_row=ENTETE, max_row=n)

    # Année N : aire, barres ou courbe, comme à l'écran
    if forme == "aire":
        g = AreaChart(grouping="standard")
        g.add_data(col(2), titles_from_data=True)
        g.series[0].graphicalProperties = GraphicalProperties(
            solidFill=_clair(couleur), ln=LineProperties(noFill=True))
    elif forme == "barres":
        g = BarChart(type="col", gapWidth=40)
        g.add_data(col(2), titles_from_data=True)
        g.series[0].graphicalProperties = GraphicalProperties(
            solidFill=couleur, ln=LineProperties(noFill=True))
        g.series[0].invertIfNegative = False
    else:
        g = LineChart()
        g.add_data(col(2), titles_from_data=True)
        _serie_trait(g.series[0], couleur, 2.5, points=True, rayon=6)
    g.set_categories(cats)

    # N-1 en gris et objectif en pointillés rouges, en courbes par-dessus
    autres = LineChart()
    if forme == "aire":
        # Contour de l'aire : seulement le trait du haut, comme à l'écran (pas dans la légende)
        autres.add_data(col(2), titles_from_data=True)
        _serie_trait(autres.series[-1], couleur, 2.5)
    i = 3
    if avec_n1:
        autres.add_data(col(i), titles_from_data=True)
        _serie_trait(autres.series[-1], GRIS_N1, 2, tirets=style_n1 == "tirets",
                     points=style_n1 == "points")
        i += 1
    if avec_obj:
        autres.add_data(col(i), titles_from_data=True)
        _serie_trait(autres.series[-1], ROUGE, 2, tirets=True)
    if autres.series:
        autres.set_categories(cats)
        g += autres
    _habiller(g, titre, format_axe)
    if forme == "aire":
        g.legend.legendEntry = [LegendEntry(idx=1, delete=True)]
    _poser(ws, g, len(mois), len(colonnes))


def _feuille_effectif(wb: Workbook, nom_n: str, mois: list[str], total: list,
                      contrats: list[tuple[str, list]]) -> None:
    """Une courbe par type de contrat, valeur inscrite sur chaque point, comme à l'écran ;
    l'effectif total reste dans le tableau (seule courbe s'il n'y a aucun contrat)."""
    ws = wb.create_sheet("Effectif")
    colonnes = contrats + [("Effectif total", total)]
    _tableau(ws, "Effectif", f"Effectif par type de contrat · Année {nom_n}", mois, colonnes,
             "#,##0")
    n = ENTETE + len(mois)
    g = LineChart()
    for i in range(len(contrats) or 1):
        g.add_data(Reference(ws, min_col=2 + i, min_row=ENTETE, max_row=n),
                   titles_from_data=True)
        s = g.series[-1]
        _serie_trait(s, DATA[1 + i % 5], 2.5, points=True, rayon=6)
        s.dLbls = DataLabelList(showVal=True, showSerName=False, showCatName=False,
                                showLegendKey=False, showPercent=False, dLblPos="t")
        s.dLbls.txPr = _riche(800, ENCRE)
    g.set_categories(Reference(ws, min_col=1, min_row=ENTETE + 1, max_row=n))
    _habiller(g, "Effectif", FORMATS["entier"][0])
    _poser(ws, g, len(mois), len(colonnes))


def graphiques(r: dict, nom_n: str, nom_n1: str, ids: list[str] | None = None) -> bytes:
    """`ids` : graphes choisis à l'écran (identifiants de `IDS_ECRAN`) ; None = tous."""
    voulus = None if ids is None else {IDS_ECRAN[i] for i in ids if i in IDS_ECRAN}
    serie_n = r.get("serie_n") or []
    serie_n1 = r.get("serie_n1") or []
    mois = [MOIS_COURTS[(m["mois"] - 1) % 12] for m in serie_n]
    wb = Workbook()

    for spec in GRAPHES:
        ident, nom, _, lire, cle_obj, *_ = spec
        if voulus is not None and nom not in voulus:
            continue
        if ident == "effectif":
            contrats = [c["contrat"] for c in (r.get("d_contrat") or {}).get("effectifs", [])]
            total = [m.get("effectif") for m in serie_n]
            par_contrat = [(c, [(m.get("effectif_contrat") or {}).get(c) for m in serie_n])
                           for c in contrats]
            if _rempli(total) or any(_rempli(col) for _, col in par_contrat):
                _feuille_effectif(wb, nom_n, mois, total, par_contrat)
            continue
        n = [_nombre(lire(m)) for m in serie_n]
        n1 = [_nombre(lire(serie_n1[i])) if i < len(serie_n1) else None
              for i in range(len(serie_n))]
        if not (_rempli(n) or _rempli(n1)):
            continue
        colonnes = [(nom_n, n)]
        avec_n1 = _rempli(n1)
        if avec_n1:
            colonnes.append((nom_n1, n1))
        obj = [_nombre((m.get("objectifs") or {}).get(cle_obj)) for m in serie_n] if cle_obj else []
        avec_obj = _rempli(obj)
        if avec_obj:
            colonnes.append(("Objectif", obj))
        _feuille(wb, spec, mois, colonnes, avec_n1, avec_obj)

    if len(wb.sheetnames) == 1:
        wb.create_sheet("Graphes").append(["Aucune donnée sur la période choisie."])
    return _sortie(wb)
