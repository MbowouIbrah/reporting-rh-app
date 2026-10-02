"""Classeurs xlsx construits à partir du rapport JSON déjà filtré (périmètre, marge) :
l'export est donc identique à l'écran, au FCFA près."""

from decimal import Decimal, InvalidOperation
from io import BytesIO

from openpyxl import Workbook
from openpyxl.styles import Font

MOIS = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
        "septembre", "octobre", "novembre", "décembre"]
CELL = ("m1", "m", "var", "var_pct")
BUDGET = ("budget", "ecart", "ecart_pct")


def _val(v):
    """Chaîne décimale -> Decimal (cellule numérique exacte) ; 'n/a' reste du texte ; None vide."""
    if isinstance(v, str):
        try:
            return Decimal(v)
        except InvalidOperation:
            return v
    return v


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


def _cell(c: dict, avec_budget: bool = False) -> list:
    out = [c.get(k) for k in CELL]
    return out + [c.get(k) for k in BUDGET] if avec_budget else out


def _sortie(wb: Workbook) -> bytes:
    del wb["Sheet"]
    buf = BytesIO()
    wb.save(buf)
    return buf.getvalue()


def mensuel(r: dict, annee: int, mois: int) -> bytes:
    wb = Workbook()
    ent = ["", "M-1", f"M ({MOIS[mois - 1]} {annee})", "Var", "Var %"]
    ent_b = [*ent, "Budget", "Écart", "Écart %"]
    s = r["synthese"]
    eff = s["effectif"]
    lignes = [
        ["Masse salariale", *_cell(s["ms"], True)],
        ["Effectif (fin de mois)", None, eff["fin"], eff.get("variation")],
        ["Taux de rotation", None, s["taux_rotation"]],
        ["Absences (nb)", *_cell(s["absences"])],
        ["Taux d'absentéisme", None, s["taux_absenteisme"]],
        ["Commissions", *_cell(s["commissions"])],
        ["Primes (total)", *_cell(s["primes_total"])],
        *[[f"Prime : {p['rubrique']}", *_cell(p)] for p in s["primes"]],
    ]
    for cle, lib in (("ca", "Chiffre d'affaires"), ("marge", "Marge"),
                     ("taux_marge", "Taux de marge")):
        if cle in s:
            lignes.append([lib, None, s[cle]])
    _feuille(wb, "Synthèse", ent_b, lignes)
    _feuille(wb, "A Type de charge", ent_b,
             [[x["rubrique"], *_cell(x, True)] for x in r["a_type_charge"]])
    b = []
    for sv in r["b_service_activite"]:
        b.append([sv["service"], *_cell(sv["total"], True)])
        b.append([f"  {sv['service']} : effectif", *_cell(sv["effectif"])])
        for a in sv["activites"]:
            b.append([f"  {a['activite']}", *_cell(a)])
            b.append([f"  {a['activite']} : effectif", *_cell(a["effectif"])])
    _feuille(wb, "B Service", ent_b, b)
    _feuille(wb, "C Site",
             ["Site", "MS M-1", "MS M", "Var", "Var %", "Budget", "Écart", "Écart %",
              "Effectif M-1", "Effectif M"],
             [[x["site"], *_cell(x["ms"], True), x["effectif"]["m1"], x["effectif"]["m"]]
              for x in r["c_site"]])
    d = r["d_contrat"]
    lig = [[f"Effectif {x['contrat']}", *_cell(x)] for x in d["effectifs"]]
    lig.append(["Effectif total", *_cell(d["total"])])
    lig += [[f"{x['contrat']} · {x['activite']} : MS", *_cell(x["ms"])] for x in d["ventilation"]]
    lig += [[f"{x['contrat']} · {x['activite']} : effectif", *_cell(x["effectif"])]
            for x in d["ventilation"]]
    _feuille(wb, "D Contrat", ent, lig)
    _feuille(wb, "Indicateurs contrat",
             ["Contrat", "Début", "Recrutements", "Départs", "Fin", "Taux rotation", "Absences",
              "Taux absentéisme"],
             [[i["contrat"], i["debut"], i["recrutements"], i["departs"], i["fin"],
               i["taux_rotation"], i["absences"], i["taux_absenteisme"]]
              for i in d["indicateurs"]])
    _feuille(wb, "Contrôles", ["Contrôle", "Écart", "Bloquant"],
             [[c["controle"], c["ecart"], "oui" if c["bloquant"] else "non"]
              for c in r["controles"]])
    return _sortie(wb)


def annuel(r: dict, annee: int, mois: int) -> bytes:
    wb = Workbook()
    cols = ["Mois", "MS", "Effectif", "Absences", "Commissions", "Primes"]
    marge = bool(r["serie_n"]) and "ca" in r["serie_n"][0]
    if marge:
        cols += ["CA", "Marge", "Taux de marge"]

    def serie(s):
        return [[MOIS[x["mois"] - 1], x["ms"], x["effectif"], x["absences"], x["commissions"],
                 x["primes"],
                 *([x.get("ca"), x.get("marge"), x.get("taux_marge")] if marge else [])]
                for x in s]

    _feuille(wb, str(annee), cols, serie(r["serie_n"]))
    _feuille(wb, str(annee - 1), cols, serie(r["serie_n1"]))
    c = r["cumul_ytd"]
    _feuille(wb, "Cumul",
             ["", f"{annee - 1}", f"{annee} (jusqu'à {MOIS[mois - 1]})", "Var", "Var %"],
             [["Cumul", *_cell(c)], ["Mois saisis", c["nb_mois_n1"], c["nb_mois"]],
              ["Moyenne mensuelle", *_cell(r["moyenne_mensuelle"])],
              *([["Marge cumulée", None, r.get("marge_ytd")]] if marge else [])])
    _feuille(wb, "Par service",
             ["Service", f"{annee - 1}", f"{annee}", "Var", "Var %", "Moy. N-1", "Moy. N",
              "Écart moy. %", "Mois N-1", "Mois N"],
             [[x["service"], *_cell(x), x["moy_m1"], x["moy_m"], x["ecart_moy_pct"],
               x["nb_mois_n1"], x["nb_mois"]] for x in r["par_service"]])
    return _sortie(wb)
