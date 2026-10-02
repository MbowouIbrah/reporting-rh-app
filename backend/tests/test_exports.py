from decimal import Decimal as D
from io import BytesIO

from openpyxl import load_workbook
from sqlalchemy import select

from app.models.auth import AuditEvent
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


def test_mensuel_identique_a_l_ecran(charge):
    ecran = get(charge, "mensuel", annee=2026, mois=2).json()
    wb = classeur(get(charge, "mensuel/export", annee=2026, mois=2))
    assert wb.sheetnames[:3] == ["Synthèse", "A Type de charge", "B Service"]
    a = lignes(wb["A Type de charge"])
    for x in ecran["a_type_charge"]:
        assert D(str(a[x["rubrique"]][1])) == D(x["m"]), x["rubrique"]
        assert D(str(a[x["rubrique"]][0])) == D(x["m1"]), x["rubrique"]
    assert D(str(lignes(wb["Synthèse"])["Masse salariale"][1])) == D(ecran["synthese"]["ms"]["m"])
    sites = lignes(wb["C Site"])
    for x in ecran["c_site"]:
        assert D(str(sites[x["site"]][1])) == D(x["ms"]["m"])


def test_annuel_identique_a_l_ecran(charge):
    ecran = get(charge, "annuel", annee=2026, mois=2).json()
    wb = classeur(get(charge, "annuel/export", annee=2026, mois=2))
    assert wb.sheetnames == ["2026", "2025", "Cumul", "Par service"]
    cumul = lignes(wb["Cumul"])["Cumul"]
    assert D(str(cumul[1])) == D(ecran["cumul_ytd"]["m"])
    svc = lignes(wb["Par service"])
    for x in ecran["par_service"]:
        assert D(str(svc[x["service"]][1])) == D(x["m"])


def test_perimetre_et_marge_respectes(make_client, charge):
    equip = make_client(EQUIP)
    wb = classeur(get(equip, "mensuel/export", annee=2026, mois=2))
    svc = {k: v for k, v in lignes(wb["B Service"]).items() if not k.startswith(" ")}
    assert D(str(svc["SAV PL"][1])) == D("1600")
    assert all(D(str(v[1])) == 0 for k, v in svc.items() if k != "SAV PL")  # hors périmètre : vide
    assert "Chiffre d'affaires" not in lignes(wb["Synthèse"])
    assert "Marge" not in lignes(wb["Synthèse"])
    drh = make_client(DRH)
    wb = classeur(get(drh, "mensuel/export", annee=2026, mois=1))
    assert "Chiffre d'affaires" in lignes(wb["Synthèse"])


def test_export_audite_et_404(charge, db):
    classeur(get(charge, "mensuel/export", annee=2026, mois=2, service="SAV PL"))
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "export")).one()
    assert (ev.entite, ev.entite_id, ev.apres) == (
        "rapport_mensuel", "2026-02", {"service": "SAV PL", "site": None})
    assert get(charge, "mensuel/export", annee=2030, mois=1).status_code == 404
