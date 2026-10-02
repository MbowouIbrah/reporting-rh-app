from decimal import Decimal as D

from sqlalchemy import select

from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.referentiel import Rubrique, Service, Site
from tests import test_rapports_api as rapports

API, DRH, EQUIP = rapports.API, rapports.DRH, rapports.EQUIP
get = rapports.get
charge = rapports.charge  # fixture partagée (2026-01 et 2026-02 chargées)


def ids(db):
    pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
    sav = db.scalar(select(Service.id).where(Service.libelle == "SAV PL"))
    vn = db.scalar(select(Service.id).where(Service.libelle == "Commerce VN"))
    yde = db.scalar(select(Site.id).where(Site.libelle == "Yaoundé"))
    brut = db.scalar(select(Rubrique.id).where(Rubrique.libelle == "Brut Réel"))
    absn = db.scalar(select(Rubrique.id).where(Rubrique.libelle == "Absences (nb)"))
    return pid, sav, vn, yde, brut, absn


def put(c, pid, lignes):
    return c.put(f"{API}/budgets/{pid}", json={"lignes": lignes})


def test_saisie_exacte_audit_et_suppression(charge, db):
    pid, sav, _, _, brut, _ = ids(db)
    r = put(charge, pid, [{"axe": "rubrique", "cible_id": brut, "valeur": "1234567,891"},
                          {"axe": "service", "cible_id": sav, "valeur": "900"}])
    assert r.status_code == 200
    v = {x["cible_id"]: x["valeur"] for x in r.json()["lignes"]["rubrique"]}
    assert v[brut] == "1234567.891"
    assert db.scalars(select(AuditEvent).where(AuditEvent.action == "saisie_budget")).one()
    r = put(charge, pid, [{"axe": "rubrique", "cible_id": brut, "valeur": None}])
    assert all(x["valeur"] is None for x in r.json()["lignes"]["rubrique"])
    assert charge.get(f"{API}/budgets", params={"periode_id": pid}).status_code == 200


def test_refus(charge, make_client, db):
    pid, sav, _, _, brut, absn = ids(db)
    ligne = {"axe": "service", "cible_id": sav, "valeur": "10"}
    assert put(make_client(DRH), pid, [ligne]).status_code == 403
    for mauvais in ({"valeur": "abc"}, {"valeur": "-5"}, {"cible_id": 9999},
                    {"axe": "rubrique", "cible_id": absn}):
        assert put(charge, pid, [{**ligne, **mauvais}]).status_code == 422, mauvais
    assert put(charge, pid, [ligne, ligne]).status_code == 422
    assert put(charge, 9999, [ligne]).status_code == 404
    charge.post(f"{API}/periodes/{pid}/cloturer")
    assert put(charge, pid, [ligne]).status_code == 409
    assert charge.post(f"{API}/budgets/{pid}/copie", json={"depuis": pid + 1}).status_code == 409


def test_copie(charge, db):
    pid, sav, _, _, brut, _ = ids(db)
    fev = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 2))
    assert charge.post(f"{API}/budgets/{fev}/copie", json={"depuis": pid}).status_code == 422
    put(charge, pid, [{"axe": "service", "cible_id": sav, "valeur": "900"}])
    put(charge, fev, [{"axe": "rubrique", "cible_id": brut, "valeur": "5"}])
    r = charge.post(f"{API}/budgets/{fev}/copie", json={"depuis": pid})
    assert r.status_code == 200
    svc = [x["valeur"] for x in r.json()["lignes"]["service"] if x["cible_id"] == sav]
    assert svc == ["900.000"]
    assert all(x["valeur"] is None for x in r.json()["lignes"]["rubrique"])  # remplacement
    assert charge.post(f"{API}/budgets/{fev}/copie", json={"depuis": fev}).status_code == 422
    assert charge.post(f"{API}/budgets/{fev}/copie", json={"depuis": 9999}).status_code == 404


def test_rapport_ecarts_et_perimetre(charge, make_client, db):
    pid, sav, vn, yde, brut, _ = ids(db)
    put(charge, pid, [{"axe": "rubrique", "cible_id": brut, "valeur": "5000"},
                      {"axe": "service", "cible_id": sav, "valeur": "900"},
                      {"axe": "service", "cible_id": vn, "valeur": "100"},
                      {"axe": "site", "cible_id": yde, "valeur": "7000"}])
    r = get(charge, "mensuel", annee=2026, mois=1).json()
    a = {x["rubrique"]: x for x in r["a_type_charge"]}
    assert D(a["Brut Réel"]["budget"]) == 5000 and D(a["Brut Réel"]["ecart"]) == D("2000.5")  # 7000,5 - 5000
    svc = {b["service"]: b["total"] for b in r["b_service_activite"]}
    assert D(svc["SAV PL"]["ecart"]) == D("100.5")
    sites = {c["site"]: c["ms"] for c in r["c_site"]}
    assert D(sites["Yaoundé"]["budget"]) == 7000
    assert a["TOTAL CHARGES"]["budget"] == r["synthese"]["ms"]["budget"]
    # filtre site : pas de budget service ni rubrique (réel incomplet)
    f = get(charge, "mensuel", annee=2026, mois=1, site="Yaoundé").json()
    assert all(x["budget"] is None for x in f["a_type_charge"] if x["rubrique"] != "TOTAL CHARGES")
    assert all(b["total"]["budget"] is None for b in f["b_service_activite"])
    # utilisateur de périmètre : jamais de budget rubrique ni hors périmètre
    e = get(make_client(EQUIP), "mensuel", annee=2026, mois=1).json()
    assert all(x["budget"] is None for x in e["a_type_charge"] if x["rubrique"] != "TOTAL CHARGES")
    es = {b["service"]: b["total"]["budget"] for b in e["b_service_activite"]}
    assert es["SAV PL"] is not None and es["Commerce VN"] is None
