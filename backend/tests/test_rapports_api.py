from decimal import Decimal as D

import pytest
from sqlalchemy import select

from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import CaPeriode
from tests.test_import_regles import ligne, xlsx

API = "/api/v1"
ADMIN, DRH, EQUIP, VN = ("admin@exemple.invalid", "drh@exemple.invalid", "dps.equipment@exemple.invalid",
                         "dir.commercial.vn@exemple.invalid")
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
BR, ABS = "Brut Réel", "Absences (nb)"


def donnees():
    jan = [
        ligne(MATRICULE="E1", Noms="Ann", Service="SAV PL", **{BR: "1000.5", ABS: 2}),
        ligne(MATRICULE="E2", Noms="Bob", Service="Commerce VN", Site="Yaoundé", **{BR: 2000}),
        ligne(MATRICULE="E3", Noms="Cy", Service="Administration", Site="Yaoundé", **{BR: 4000}),
    ]
    fev = [
        ligne(MOIS="Février", MATRICULE="E1", Noms="Ann", Service="SAV PL", **{BR: 1100}),
        ligne(MOIS="Février", MATRICULE="E2", Noms="Bob", Service="Commerce VN", Site="Yaoundé",
              **{BR: 2100, "Primes sur ventes": 999}),
        ligne(MOIS="Février", MATRICULE="E4", Noms="Dee", Service="SAV PL", **{BR: 500}),
    ]
    return jan + fev


@pytest.fixture()
def charge(make_client, db):
    c = make_client(ADMIN)
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(donnees()), XLSX)}).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
    db.add(CaPeriode(periode_id=pid, valeur=D("10000")))
    db.commit()
    return c


def get(c, path, **params):
    return c.get(f"{API}/rapports/{path}", params=params)


def test_anonyme_401(make_client):
    assert get(make_client(), "mensuel", annee=2026, mois=1).status_code == 401


def test_mensuel_global_exact_en_chaines(charge):
    r = get(charge, "mensuel", annee=2026, mois=2).json()
    s = r["synthese"]
    # février : 1100 + 2100 + 500 ; la prime sur ventes (exclue du total) ne compte pas
    assert s["ms"]["m"] == "3700.000" or s["ms"]["m"] == "3700"
    assert s["ms"]["m1"] in ("7000.500", "7000.5")
    e = s["effectif"]
    assert (e["debut"], e["recrutements"], e["departs"], e["fin"]) == (3, 1, 1, 3)
    assert s["ca"] is None and s["marge"] is None
    assert all(not c["bloquant"] for c in r["controles"])


def test_marge_visible_admin_et_drh_seulement(charge, make_client):
    for who, visible in ((ADMIN, True), (DRH, True), (EQUIP, False), (VN, False)):
        s = get(make_client(who), "mensuel", annee=2026, mois=1)
        if who in (EQUIP, VN):
            assert "ca" not in s.json()["synthese"] and "marge" not in s.json()["synthese"]
        else:
            assert s.json()["synthese"]["marge"] is not None
        assert s.status_code == 200 and visible == ("marge" in s.json()["synthese"])


def test_perimetre_filtre_cote_serveur(charge, make_client):
    equip = get(make_client(EQUIP), "mensuel", annee=2026, mois=1).json()
    assert D(equip["synthese"]["ms"]["m"]) == D("1000.5")  # SAV PL seul (pas Admin/Commerce VN)
    assert equip["synthese"]["effectif"]["fin"] == 1
    vn = get(make_client(VN), "mensuel", annee=2026, mois=1).json()
    assert D(vn["synthese"]["ms"]["m"]) == 2000
    # le filtre de l'utilisateur ne peut pas élargir le périmètre
    r = get(make_client(EQUIP), "mensuel", annee=2026, mois=1, service="Administration")
    assert r.status_code == 404
    # annuel et périodes passent par le même filtre
    assert D(get(make_client(VN), "annuel", annee=2026, mois=2).json()["cumul_ytd"]["m"]) == 4100
    assert len(get(make_client(VN), "periodes").json()) == 2


def test_filtre_utilisateur_restreint(charge):
    r = get(charge, "mensuel", annee=2026, mois=1, service="SAV PL").json()
    assert D(r["synthese"]["ms"]["m"]) == D("1000.5")


def test_periode_inconnue_404(charge):
    assert get(charge, "mensuel", annee=2026, mois=7).status_code == 404
    assert get(charge, "annuel", annee=2020).status_code == 404
    assert get(charge, "mensuel", annee=2026, mois=13).status_code == 422


def test_annuel_global(charge):
    r = get(charge, "annuel", annee=2026, mois=2).json()
    assert D(r["cumul_ytd"]["m"]) == D("10700.5") and r["cumul_ytd"]["nb_mois"] == 2
    assert D(r["moyenne_mensuelle"]["m"]) == D("5350.25")
    assert D(r["marge_ytd"]) == D("10000") - D("7000.5") and r["nb_mois_marge"] == 1
    assert r["cumul_ytd"]["m1"] is None


def test_individuel_nominatif_et_journal(charge, make_client, db):
    assert get(make_client(EQUIP), "individuel", annee=2026, matricule="E1").status_code == 403
    assert get(make_client(VN), "individuel", annee=2026, matricule="E2").status_code == 403
    r = get(make_client(DRH), "individuel", annee=2026, matricule="e1")
    assert r.status_code == 200
    j = r.json()
    assert j["nom"] == "Ann" and j["nb_mois"] == 2 and D(j["cumul"]) == D("2100.5")
    assert j["mois"][0]["rubriques"][ABS] in ("2", "2.000")
    assert j["mois"][0]["rubriques"]["Commission"] is None
    assert get(charge, "individuel", annee=2026, matricule="ZZZ").status_code == 404
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "lecture_fiche")).all()
    assert len(ev) == 1


def test_individuel_tous(charge, make_client):
    assert get(make_client(EQUIP), "individuel/tous", annee=2026).status_code == 403
    j = get(make_client(DRH), "individuel/tous", annee=2026).json()
    mat = [x["matricule"] for x in j["salaries"]]
    assert mat == sorted(mat) and "E1" in mat and "E3" in mat
    e1 = next(x for x in j["salaries"] if x["matricule"] == "E1")
    assert len(e1["totaux"]) == 12 and e1["nb_mois"] == 2 and D(e1["cumul"]) == D("2100.5")


def test_individuel_hors_perimetre_nominatif(charge, make_client, db):
    """Un lecteur à périmètre avec drapeau nominatif ne voit que son périmètre."""
    from app.models.auth import RoleAssignment, Utilisateur

    u = db.scalar(select(Utilisateur).where(Utilisateur.email == EQUIP))
    a = db.scalar(select(RoleAssignment).where(RoleAssignment.utilisateur_id == u.id))
    a.nominatif = True
    db.commit()
    c = make_client(EQUIP)
    assert get(c, "individuel", annee=2026, matricule="E1").status_code == 200
    assert get(c, "individuel", annee=2026, matricule="E3").status_code == 404  # Administration


def test_filtres_et_salaries(charge, make_client):
    f = get(make_client(EQUIP), "filtres", annee=2026).json()
    assert f["services"] == ["SAV PL"]
    assert get(make_client(VN), "filtres", annee=2026).json()["services"] == ["Commerce VN"]
    assert "Administration" in get(charge, "filtres", annee=2026).json()["services"]
    assert get(make_client(EQUIP), "salaries", annee=2026).status_code == 403
    noms = [x["matricule"] for x in get(make_client(DRH), "salaries", annee=2026).json()]
    assert noms == sorted(noms) and "E1" in noms


def test_annuel_serie_sans_marge_pour_perimetre(charge, make_client):
    equip = get(make_client(EQUIP), "annuel", annee=2026, mois=2).json()
    assert all("marge" not in x and "taux_marge" not in x for x in equip["serie_n"])
    assert "commissions" in equip["serie_n"][0] and "primes" in equip["serie_n"][0]
    adm = get(charge, "annuel", annee=2026, mois=2).json()
    assert adm["serie_n"][0]["marge"] is not None
    sav = next(x for x in adm["par_service"] if x["service"] == "SAV PL")
    assert sav["nb_mois"] == 2 and sav["moy_m"] is not None


def test_mensuel_bloc_d_indicateurs_et_permissions(charge, make_client):
    r = get(charge, "mensuel", annee=2026, mois=2).json()
    ind = r["d_contrat"]["indicateurs"]
    assert ind[-1]["contrat"] == "TOTAL" and ind[-1]["fin"] == 3
    assert sum(x["fin"] for x in ind[:-1]) == ind[-1]["fin"]
    assert not any(c["bloquant"] for c in r["controles"])
    me = make_client(EQUIP).get(f"{API}/auth/me").json()
    assert "report:read" in me["permissions"] and "nominatif:read" not in me["permissions"]
