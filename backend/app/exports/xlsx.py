"""Classeurs xlsx construits à partir du rapport JSON déjà filtré (périmètre, marge) et qui
reprennent les blocs de l'écran ligne pour ligne (mêmes lignes masquées, mêmes totaux) :
l'export est donc identique à l'écran, au FCFA près."""

from decimal import Decimal, InvalidOperation
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font

from app.kpi import exercice as ex

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]
CELL = ("m1", "m", "var", "var_pct")
BUDGET = ("budget", "ecart", "ecart_pct")
TOTAL = "TOTAL CHARGES"


def _val(v):
    """Chaîne décimale -> Decimal (cellule numérique exacte) ; 'n/a' reste du texte ; None vide."""
    if isinstance(v, str):
        try:
            return Decimal(v)
        except InvalidOperation:
            return v
    return v


def _non_nul(v) -> bool:
    """Règle de l'écran (BlocsRapport.nonNul) : ligne à zéro des deux côtés masquée."""
    return v is not None and Decimal(str(v)) != 0


def _feuille(wb: Workbook, titre: str, entetes: list[str], lignes: list[list]):
    ws = wb.create_sheet(titre[:31])
    ws.append(entetes)
    for c in ws[1]:
        c.font = Font(bold=True)
    for ligne in lignes:
        ws.append([_val(v) for v in ligne])
    ws.freeze_panes = "A2"
    for i, e in enumerate(entetes, start=1):
        ws.column_dimensions[ws.cell(1, i).column_letter].width = max(14, len(e) + 2)
    ws.column_dimensions["A"].width = 34
    return ws


def _libelle(lib: str, c: dict) -> str:
    """Mention « partiel » de l'écran (total auquel il manque une case attendue)."""
    return f"{lib} (partiel)" if c.get("partiel") else lib


def _cell(c: dict, avec_budget: bool = False) -> list:
    out = [c.get(k) for k in CELL]
    return out + [c.get(k) for k in BUDGET] if avec_budget else out


def _sortie(wb: Workbook) -> bytes:
    del wb["Sheet"]
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


# Libellés des familles de rubriques (kpi/moteur.py FAMILLES).
FAMILLES = {"salaire": "Salaire", "primes": "Primes", "avantages": "Avantages et frais",
            "charges": "Charges"}


def _blocs(wb: Workbook, r: dict, prec: str, cour: str) -> None:
    """Blocs 1 à 5 communs aux écrans Mensuel et Annuel (components/BlocsRapport.tsx)."""
    var = ["Variation", "Var. %"]
    bud = ["Budget", "Écart", "% Budget"]
    total = next((x for x in r["a_type_charge"] if x["rubrique"] == TOTAL), None)
    ligne_total = [["TOTAL GÉNÉRAL", *_cell(total, True)]] if total else []
    # « dont Frais de mission » : déjà compté dans le total, repris dessous avec son budget.
    fm = r.get("frais_mission")
    frais = [["dont Frais de mission", *_cell(fm, True)]] if fm else []
    # CA et marge sous le total, hors total, avec leur objectif ; absents sans droit marge.
    cm = r.get("lignes_ca_marge")
    ca_marge = [[_libelle(lib, cm[k]) + (" (objectif partiel)" if cm[k].get("budget_partiel")
                                         else ""), *_cell(cm[k], True)]
                for k, lib in (("ca", "Chiffre d'affaires"), ("marge", "Marge"))] if cm else []

    inclus = [x for x in r["a_type_charge"] if x["rubrique"] != TOTAL and not x.get("exclu")]
    _feuille(wb, "1 Reporting global", ["Type de charge", prec, cour, *var, *bud, "Famille"],
             [[x["rubrique"], *_cell(x, True), FAMILLES.get(x.get("famille"))] for x in inclus]
             + ligne_total + frais + ca_marge)
    exclus = [x for x in r["a_type_charge"] if x["rubrique"] != TOTAL and x.get("exclu")]
    if exclus:
        _feuille(wb, "Charges exclues", ["Charge exclue", prec, cour, *var, *bud],
                 [[x["rubrique"], *_cell(x, True)] for x in exclus])

    b = []
    for sv in r["b_service_activite"]:
        if not (_non_nul(sv["total"]["m"]) or _non_nul(sv["total"]["m1"])):
            continue
        b.append([sv["service"], *_cell(sv["total"], True)])
        b += [[f"  {a['activite']}", *_cell(a)]
              for a in sv["activites"] if _non_nul(a["m"]) or _non_nul(a["m1"])]
    b += ligne_total
    b.append(["Effectif global", *_cell(r["d_contrat"]["total"])])
    _feuille(wb, "2 Service et activité", ["Service / activité", prec, cour, *var, *bud], b)

    s = []
    for x in r["c_site"]:
        s.append([x["site"], "MS", *_cell(x["ms"], True)])
        s.append([None, "Eff", x["effectif"]["m1"], x["effectif"]["m"]])
    _feuille(wb, "3 Site", ["Site", "Rubrique", prec, cour, *var, *bud], s)

    ind = r["d_contrat"]["indicateurs"]
    cols = [ind[-1], *ind[:-1]]  # colonne Total en premier, comme à l'écran
    _feuille(wb, "4 Effectifs", ["Indicateur", *[i["contrat"] for i in cols]],
             [[lib, *[i[k] for i in cols]] for lib, k in (
                 ("Effectif début", "debut"), ("Recrutements", "recrutements"),
                 ("Départs", "departs"), ("Effectif fin", "fin"),
                 ("Taux de rotation", "taux_rotation"), ("Absences (jours)", "absences"),
                 ("Taux d'absentéisme", "taux_absenteisme"))])

    c = []
    for v in r["d_contrat"]["ventilation"]:
        if not any(_non_nul(v[g][k]) for g in ("ms", "effectif") for k in ("m", "m1")):
            continue
        c.append([f"{v['contrat']} · {v['activite']}", "Masse salariale", *_cell(v["ms"])])
        c.append([None, "Effectifs", *_cell(v["effectif"])])
    if total:
        c.append(["TOTAL GÉNÉRAL", "Masse salariale", *_cell(total)])
        c.append([None, "Effectifs", *_cell(r["d_contrat"]["total"])])
    _feuille(wb, "5 Contrat", ["Contrat · activité", "Indicateur", prec, cour, *var], c)

    if r.get("activite"):
        _feuille(wb, "6 Activité", ["Indicateur", prec, cour, *var],
                 [[_libelle(x["libelle"], x), *_cell(x)] for x in r["activite"]])


def mensuel(r: dict, annee: int, mois: int, prec: str) -> bytes:
    wb = Workbook()
    s = r["synthese"]
    bloquants = [c["controle"] for c in r["controles"] if c["bloquant"]]
    _feuille(wb, "Synthèse", ["Indicateur", f"{MOIS[mois - 1]} {annee}"], [
        ["Contrôles de cohérence", "Écarts : " + " ; ".join(bloquants) if bloquants else "OK"],
        ["Effectif fin de mois", s["effectif"]["fin"]],
        ["Taux de rotation", s["taux_rotation"]],
        ["Taux d'absentéisme", s["taux_absenteisme"]],
    ])
    _blocs(wb, r, prec, f"{MOIS[mois - 1]} {annee}")
    return _sortie(wb)


def annuel(r: dict, annee: int, mois: int, ref_annee: int | None = None,
           calendrier: str = "civil") -> bytes:
    """`annee` : début de l'exercice ; `mois` : vrai mois de fin du cumul."""
    wb = Workbook()
    fiscal = calendrier == "fiscal"
    debut = f"d'{MOIS[ex.DEBUT_FISCAL - 1]} {annee}" if fiscal else "de janvier"
    fin = ex.fin_cumul(annee, mois, calendrier)[0]
    lignes = [
        ["Période", f"Cumul {debut} à {MOIS[mois - 1]} {fin}"],
        ["Moyenne mensuelle", r["moyenne_mensuelle"]["m"]],
        ["Mois saisis", r["cumul_ytd"]["nb_mois"]],
    ]
    if "marge_ytd" in r:
        lignes.append(["Marge cumulée", r["marge_ytd"]])
        lignes.append(["Mois avec marge saisie", r["nb_mois_marge"]])
    ref = ref_annee or annee - 1
    def nom(a: int) -> str:
        return f"{a}-{(a + 1) % 100:02d}" if fiscal else str(a)
    _feuille(wb, "Synthèse", ["Indicateur", nom(annee)], lignes)
    _blocs(wb, r, nom(ref), nom(annee))
    return _sortie(wb)
