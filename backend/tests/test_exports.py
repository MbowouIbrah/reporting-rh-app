from decimal import Decimal as D
from io import BytesIO

from openpyxl import load_workbook
from sqlalchemy import select

from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import Budget, ValeurSaisie
from app.models.referentiel import Rubrique
from tests import test_rapports_api as rapports

API, DRH, EQUIP = rapports.API, rapports.DRH, rapports.EQUIP
get = rapports.get
charge = rapports.charge  # fixture partagée (2026-01 et 2026-02 chargées)
XLSX = rapports.XLSX


def classeur(r):
    assert r.status_code == 200, r.text
    assert r.headers["content-type"].startswith(XLSX)
    assert "attachment" in r.headers["content-disposition"]
    return load_workbook(BytesIO(r.content), data_only=True)


def lignes(ws):
    return {row[0]: row[1:] for row in ws.iter_rows(min_row=2, values_only=True) if row[0]}


def test_anonyme_401(make_client):
    r = get(make_client(), "mensuel/export", annee=2026, mois=2)
    assert r.status_code == 401


def eq(cellule, v):
    return cellule is None if v is None else D(str(cellule)) == D(v)


def nul(c):
    return all(v is None or D(v) == 0 for v in (c["m"], c["m1"]))


def blocs_identiques(wb, ecran):
    """Chaque bloc de l'écran (BlocsRapport.tsx) se retrouve à l'identique, lignes nulles masquées."""
    a = lignes(wb["1 Reporting global"])
    for x in ecran["a_type_charge"]:
        cle = "TOTAL GÉNÉRAL" if x["rubrique"] == "TOTAL CHARGES" else x["rubrique"]
        if x.get("exclu"):
            assert cle not in a
            assert D(str(lignes(wb["Charges exclues"])[cle][1])) == D(x["m"])
            continue
        assert eq(a[cle][1], x["m"]) and eq(a[cle][0], x["m1"]), cle
    b = lignes(wb["2 Service et activité"])
    for sv in ecran["b_service_activite"]:
        if nul(sv["total"]):
            assert sv["service"] not in b
            continue
        assert D(str(b[sv["service"]][1])) == D(sv["total"]["m"])
        for x in sv["activites"]:
            assert (f"  {x['activite']}" in b) != nul(x)
    sites = lignes(wb["3 Site"])
    for x in ecran["c_site"]:
        assert D(str(sites[x["site"]][2])) == D(x["ms"]["m"])
    eff = lignes(wb["4 Effectifs"])
    total = ecran["d_contrat"]["indicateurs"][-1]
    assert eff["Effectif fin"][0] == total["fin"]


def test_mensuel_identique_a_l_ecran(charge):
    ecran = get(charge, "mensuel", annee=2026, mois=2).json()
    wb = classeur(get(charge, "mensuel/export", annee=2026, mois=2))
    assert wb.sheetnames[:4] == ["Synthèse", "1 Reporting global", "Charges exclues", "2 Service et activité"]         or wb.sheetnames[:3] == ["Synthèse", "1 Reporting global", "2 Service et activité"]
    blocs_identiques(wb, ecran)
    syn = lignes(wb["Synthèse"])
    assert syn["Effectif fin de mois"][0] == ecran["synthese"]["effectif"]["fin"]
    assert "Chiffre d'affaires" not in syn  # absent de l'écran Mensuel


def test_annuel_identique_a_l_ecran(charge):
    ecran = get(charge, "annuel", annee=2026, mois=2).json()
    wb = classeur(get(charge, "annuel/export", annee=2026, mois=2))
    assert wb.sheetnames[0] == "Synthèse" and "4 Effectifs" in wb.sheetnames
    blocs_identiques(wb, ecran)
    syn = lignes(wb["Synthèse"])
    assert D(str(syn["Moyenne mensuelle"][0])) == D(ecran["moyenne_mensuelle"]["m"])
    assert D(str(syn["Marge cumulée"][0])) == D(ecran["marge_ytd"])
    assert syn["Mois avec marge saisie"][0] == ecran["nb_mois_marge"]


def test_perimetre_et_marge_respectes(make_client, charge):
    equip = make_client(EQUIP)
    wb = classeur(get(equip, "mensuel/export", annee=2026, mois=2))
    svc = {k: v for k, v in lignes(wb["2 Service et activité"]).items() if not k.startswith(" ")}
    assert D(str(svc["SAV PL"][1])) == D("1600")
    assert {"Commerce VN", "Administration"}.isdisjoint(svc)  # hors périmètre : masqué comme à l'écran
    assert "Marge cumulée" not in lignes(classeur(get(equip, "annuel/export", annee=2026, mois=2))["Synthèse"])
    drh = make_client(DRH)
    assert "Marge cumulée" in lignes(classeur(get(drh, "annuel/export", annee=2026, mois=2))["Synthèse"])


def test_export_audite_et_404(charge, db):
    classeur(get(charge, "mensuel/export", annee=2026, mois=2, service="SAV PL"))
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "export")).one()
    assert (ev.entite, ev.entite_id, ev.apres) == (
        "rapport_mensuel", "2026-02",
        {"service": "SAV PL", "site": None, "type_site": None, "poste": None, "matricule": None,
         "activite": None, "type_contrat": None})
    assert get(charge, "mensuel/export", annee=2030, mois=1).status_code == 404


# ---------- objectifs ----------


def objectifs_janvier(db):
    pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
    rid = db.scalar(select(Rubrique.id).where(Rubrique.libelle == "Frais de mission"))
    lignes_ = [ValeurSaisie(periode_id=pid, indicateur="obj_ca", valeur=D("12000")),
               ValeurSaisie(periode_id=pid, indicateur="obj_marge", valeur=D("3000")),
               Budget(periode_id=pid, axe="rubrique", cible_id=rid, valeur=D("123"))]
    db.add_all(lignes_)
    db.commit()


def test_export_mensuel_budget_sur_ca_marge_et_ligne_frais_de_mission(charge, db):
    objectifs_janvier(db)
    ecran = get(charge, "mensuel", annee=2026, mois=1).json()
    wb = classeur(get(charge, "mensuel/export", annee=2026, mois=1))
    g = lignes(wb["1 Reporting global"])
    ca, marge, fm = g["Chiffre d'affaires"], g["Marge"], g["dont Frais de mission"]
    # colonnes : mois précédent, mois, variation, variation %, budget, écart, écart %, famille
    assert len(ca) == 8 and ca[7] is None  # CA hors familles
    assert D(str(ca[1])) == 10000 and D(str(ca[4])) == 12000 and D(str(ca[5])) == -2000
    assert abs(float(ca[6]) - (-2000 / 12000)) < 1e-9
    assert D(str(marge[4])) == 3000 and D(str(marge[5])) == -500
    assert D(str(fm[1])) == 0 and D(str(fm[4])) == 123 and D(str(fm[5])) == -123
    assert eq(ca[4], ecran["lignes_ca_marge"]["ca"]["budget"])
    assert eq(fm[4], ecran["frais_mission"]["budget"])
    # la ligne « dont » ne change pas le total ni les lignes de rubrique
    blocs_identiques(wb, ecran)
    noms = [r[0] for r in wb["1 Reporting global"].iter_rows(min_row=2, values_only=True)]
    assert noms.index("dont Frais de mission") > noms.index("TOTAL GÉNÉRAL")
    assert noms.count("Frais de mission") == 1


def test_export_sans_droit_marge_ni_ca_ni_marge_ni_leur_objectif(make_client, charge, db):
    objectifs_janvier(db)
    equip = make_client(EQUIP)
    for chemin in ("mensuel/export", "annuel/export"):
        wb = classeur(get(equip, chemin, annee=2026, mois=1))
        for ws in wb.worksheets:
            for ligne in ws.iter_rows(values_only=True):
                assert not (ligne[0] or "").startswith(("Chiffre", "Marge"))
                assert 12000 not in ligne and 3000 not in ligne and 10000 not in ligne
    g = lignes(classeur(get(equip, "mensuel/export", annee=2026, mois=1))["1 Reporting global"])
    assert g["dont Frais de mission"][4] is None  # périmètre restreint : pas de budget de rubrique


def test_export_annuel_budget_cumule(charge, db):
    objectifs_janvier(db)
    ecran = get(charge, "annuel", annee=2026, mois=2).json()
    wb = classeur(get(charge, "annuel/export", annee=2026, mois=2))
    g = lignes(wb["1 Reporting global"])
    ca = g["Chiffre d'affaires"]
    assert D(str(ca[4])) == 12000 and eq(ca[4], ecran["lignes_ca_marge"]["ca"]["budget"])
    assert D(str(g["dont Frais de mission"][4])) == 123
