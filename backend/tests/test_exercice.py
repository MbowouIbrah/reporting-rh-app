"""Année civile ou fiscale (avril → mars) : docs/etude-annee-fiscale.md."""
import io
from decimal import Decimal as D

from openpyxl import load_workbook

from app.exports import xlsx
from app.kpi import exercice as ex
from tests.test_rapports_api import DRH, charge, get  # noqa: F401 (fixture)


def test_mois_exercice_et_rang():
    assert ex.mois_exercice(2026) == [(2026, m) for m in range(1, 13)]
    f = ex.mois_exercice(2026, "fiscal")
    assert f[0] == (2026, 4) and f[8] == (2026, 12) and f[9] == (2027, 1) and f[11] == (2027, 3)
    assert [ex.rang(m, "fiscal") for m in (4, 12, 1, 3)] == [1, 9, 10, 12]
    assert ex.rang(7) == 7


def test_en_mois_reels():
    res = {"serie_n": [{"mois": 1}, {"mois": 10}], "serie_n1": [{"mois": 12}], "mois_fin": 11}
    out = ex.en_mois_reels(res, 2025, 2024, "fiscal")
    assert out["serie_n"] == [{"mois": 4, "annee": 2025}, {"mois": 1, "annee": 2026}]
    assert out["serie_n1"] == [{"mois": 3, "annee": 2025}]
    assert (out["annee_fin"], out["mois_fin"]) == (2026, 2)
    assert ex.en_mois_reels({**res, "mois_fin": None}, 2025, 2024, "fiscal")["annee_fin"] is None


def test_annuel_fiscal(charge):  # noqa: F811
    # janvier et février 2026 tombent dans l'exercice 2025-26 (avril 2025 → mars 2026)
    r = get(charge, "annuel", annee=2025, calendrier="fiscal").json()
    assert D(r["cumul_ytd"]["m"]) == D("10700.5") and r["cumul_ytd"]["nb_mois"] == 2
    assert (r["annee_fin"], r["mois_fin"]) == (2026, 2)
    assert [(x["annee"], x["mois"]) for x in r["serie_n"]] == ex.mois_exercice(2025, "fiscal")
    assert r["serie_n1"][0]["annee"] == 2024 and r["serie_n1"][0]["mois"] == 4
    assert D(r["ca_ytd"]) == D("10000")
    # cumul arrêté à janvier (vrai mois de fin)
    j = get(charge, "annuel", annee=2025, mois=1, calendrier="fiscal").json()
    assert D(j["cumul_ytd"]["m"]) == D("7000.5") and j["mois_fin"] == 1
    # l'exercice 2026-27 n'a pas de données
    assert get(charge, "annuel", annee=2026, calendrier="fiscal").status_code == 404
    # civil inchangé ; mois absent = fin de l'année
    c = get(charge, "annuel", annee=2026).json()
    assert D(c["cumul_ytd"]["m"]) == D("10700.5") and c["annee_fin"] == 2026
    assert get(charge, "annuel", annee=2026, calendrier="autre").status_code == 422


def test_export_fiscal_libelle(charge):  # noqa: F811
    r = get(charge, "annuel/export", annee=2025, mois=2, calendrier="fiscal")
    assert r.status_code == 200 and "reporting-annuel-2025-fiscal" in r.headers[
        "content-disposition"]
    ws = load_workbook(io.BytesIO(r.content))["Synthèse"]
    valeurs = [c for row in ws.iter_rows(values_only=True) for c in row]
    assert f"Cumul d'avril 2025 à {xlsx.MOIS[1]} 2026" in valeurs
    assert "2025-26" in valeurs


def test_individuel_et_filtres_fiscal(charge, make_client):  # noqa: F811
    drh = make_client(DRH)
    t = get(drh, "individuel/tous", annee=2025, calendrier="fiscal").json()
    assert (t["mois"][0]["annee"], t["mois"][0]["mois"]) == (2025, 4)
    jan = t["mois"][9]
    assert (jan["annee"], jan["mois"]) == (2026, 1) and jan["present"] and jan["effectif"] == 3
    assert not t["mois"][0]["present"]
    i = get(drh, "individuel", annee=2025, matricule="E1", calendrier="fiscal").json()
    assert i["nb_mois"] == 2 and D(i["cumul"]) == D("2100.5")
    assert (i["mois"][9]["annee"], i["mois"][9]["mois"]) == (2026, 1)
    assert "Administration" in get(charge, "filtres", annee=2025, calendrier="fiscal").json()[
        "services"]
    assert get(charge, "filtres", annee=2026, calendrier="fiscal").json()["services"] == []
    noms = [x["matricule"] for x in get(drh, "salaries", annee=2025, calendrier="fiscal").json()]
    assert "E1" in noms
