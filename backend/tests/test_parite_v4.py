"""Parité avec les valeurs calculées par Excel et enregistrées dans REPORTING_RH_V4.xlsx.

Le classeur est lu en valeurs en cache (data_only), sans ouvrir Excel : sélection enregistrée =
juin 2026 (M) contre mai 2026 (M-1). Tolérance 0,5 FCFA (docs/PLAN_APPLICATION.md).
"""

from decimal import Decimal as D

import pytest
from openpyxl import load_workbook

from tests.test_import_regles import V4

pytestmark = pytest.mark.skipif(not V4.exists(), reason="fichier V4 requis")
API = "/api/v1"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
TOL = D("0.5")
ALIAS = {"Variable": "Commission", "Salaire brut garantie": "Salaire brut garantie"}


@pytest.fixture(scope="module")
def excel():
    wb = load_workbook(V4, data_only=True, read_only=True)
    ws = wb["REPORTING_RH_MENSUEL"]
    cells = {c.coordinate: c.value for row in ws.iter_rows() for c in row if c.value is not None}
    assert (cells["C4"], cells["D4"]) == ("Juin", 2026)
    return cells


@pytest.fixture()
def rapport(make_client):
    c = make_client("admin@exemple.invalid")
    r = c.post(f"{API}/imports", files={"fichier": ("v4.xlsx", V4.read_bytes(), XLSX)})
    assert r.status_code == 201
    assert c.post(f"{API}/imports/{r.json()['id']}/valider").status_code == 200
    r = c.get(f"{API}/rapports/mensuel", params={"annee": 2026, "mois": 6})
    assert r.status_code == 200, r.text
    return r.json()


def proche(app, xl, ou):
    if app is None or app in ("—", "n/a"):  # écart de présentation documenté
        return
    assert xl is not None, ou
    assert abs(D(str(app)) - D(str(xl))) <= TOL, (ou, app, xl)


def test_bloc_a_type_de_charge(rapport, excel):
    app = {x["rubrique"]: x for x in rapport["a_type_charge"]}
    for r in range(10, 23):
        lib = ALIAS.get(excel[f"B{r}"], excel[f"B{r}"])
        proche(app[lib]["m1"], excel[f"C{r}"], lib)
        proche(app[lib]["m"], excel[f"D{r}"], lib)
    tot = app["TOTAL CHARGES"]
    proche(tot["m1"], excel["C23"], "total M-1")
    proche(tot["m"], excel["D23"], "total M")
    proche(tot["var"], excel["E23"], "variation")
    proche(tot["var_pct"], excel["F23"], "var %")


def test_bloc_b_service_activite(rapport, excel):
    svc = {b["service"]: b for b in rapport["b_service_activite"]}
    r = 29
    while excel.get(f"B{r}") not in (None, "TOTAL GÉNÉRAL"):
        nom = excel[f"B{r}"]
        for k in (0, 2):  # Front office puis Back Office : ligne MS, ligne Staff
            act = excel[f"C{r + k}"]
            a = next(x for x in svc[nom]["activites"] if x["activite"] == act)
            proche(a["m1"], excel[f"D{r + k}"], (nom, act, "M-1"))
            proche(a["m"], excel[f"E{r + k}"], (nom, act, "M"))
            proche(a["effectif"]["m"], excel[f"E{r + k + 1}"], (nom, act, "staff"))
        r += 4
    proche(sum(D(b["total"]["m"]) for b in svc.values()), excel["E57"], "total services")


def test_bloc_c_site(rapport, excel):
    sites = {s["site"]: s for s in rapport["c_site"]}
    for r in range(64, 84, 2):
        s = sites[excel[f"B{r}"]]
        proche(s["ms"]["m1"], excel[f"D{r}"], (s["site"], "ms M-1"))
        proche(s["ms"]["m"], excel[f"E{r}"], (s["site"], "ms M"))
        proche(s["effectif"]["m"], excel[f"E{r + 1}"], (s["site"], "eff"))


def test_effectifs_rotation_absences(rapport, excel):
    s = rapport["synthese"]
    e = s["effectif"]
    assert e["fin"] == excel["D93"]
    if e["debut"] is not None:
        assert (e["debut"], e["recrutements"], e["departs"]) == (
            excel["D90"], excel["D91"], excel["D92"])
    proche(s["taux_rotation"], excel["D94"], "rotation")
    proche(s["absences"]["m"], excel["D95"], "absences")
    proche(s["absences"]["m1"], excel["C95"], "absences M-1")
    proche(s["taux_absenteisme"], excel["D96"], "absentéisme")


def test_bloc_d_contrat(rapport, excel):
    vent = {(v["contrat"], v["activite"]): v for v in rapport["d_contrat"]["ventilation"]}
    contrat = None
    for r in range(101, 113, 2):
        contrat = excel.get(f"B{r}") or contrat
        v = vent[(contrat, excel[f"C{r}"])]
        proche(v["ms"]["m1"], excel[f"E{r}"], (contrat, v["activite"], "ms M-1"))
        proche(v["ms"]["m"], excel[f"F{r}"], (contrat, v["activite"], "ms M"))
        proche(v["effectif"]["m"], excel[f"F{r + 1}"], (contrat, v["activite"], "eff"))
    proche(rapport["d_contrat"]["total"]["m"], excel["F114"], "effectif total")
