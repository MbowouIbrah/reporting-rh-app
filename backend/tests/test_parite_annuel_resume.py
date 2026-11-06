"""Parité annuel (2026) et résumé (juin 2026) avec le golden LibreOffice.

Les onglets annuel et résumé du classeur ont un sélecteur propre figé sur 2026 / juin : le golden
ne fournit qu'un point. Le résumé est assemblé comme la page : /mensuel et /annuel.
"""

import json
from decimal import Decimal as D
from pathlib import Path

import pytest
import yaml

from tests.identites import courriel
from tests.test_import_regles import V4
from tests.test_parite_v4 import API, XLSX, proche, regles_v4

RACINE = Path(__file__).parents[2] / "golden"
pytestmark = pytest.mark.skipif(
    not (RACINE / "lo_v4.json").exists() or not V4.exists(), reason="golden et fichier V4 requis")


@pytest.fixture(scope="module")
def golden():
    g = json.loads((RACINE / "lo_v4.json").read_text(encoding="utf-8"))["2026-06"]
    return g["annuel"], g["resume"]


@pytest.fixture(scope="module")
def ecarts():
    return yaml.safe_load((RACINE / "ecarts_connus.yaml").read_text(encoding="utf-8"))


@pytest.fixture()
def rapports(make_client, db):
    regles_v4(db)
    c = make_client(courriel("admin"))
    lot = c.post(f"{API}/imports", files={"fichier": ("v4.xlsx", V4.read_bytes(), XLSX)}).json()
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200

    def get(chemin, **params):
        r = c.get(f"{API}/rapports/{chemin}", params=params)
        assert r.status_code == 200, r.text
        return r.json()

    return get("annuel", annee=2026), get("annuel", annee=2026, mois=6), get("mensuel", annee=2026, mois=6)


def test_annuel(rapports, golden):
    x, _, _ = rapports
    a, _ = golden
    c = x["cumul_ytd"]
    proche(c["m1"], a["C23"], "cumul N-1")
    proche(c["m"], a["D23"], "cumul N")
    proche(c["var"], a["E23"], "variation")
    proche(c["var_pct"], a["F23"], "variation %")
    proche(c["m1"], a["D57"], "total services N-1")
    proche(c["m"], a["E57"], "total services N")
    r = 29
    while a.get(f"B{r}") not in (None, "TOTAL GÉNÉRAL"):
        s = x["par_service"][a[f"B{r}"]] if isinstance(x["par_service"], dict) else next(
            v for v in x["par_service"] if a[f"B{r}"] in v.values())
        proche(s["m1"], D(str(a[f"D{r}"])) + D(str(a[f"D{r + 2}"])), (a[f"B{r}"], "N-1"))
        proche(s["m"], D(str(a[f"E{r}"])) + D(str(a[f"E{r + 2}"])), (a[f"B{r}"], "N"))
        r += 4


def test_resume(rapports, golden, ecarts):
    _, x6, y = rapports
    _, R = golden
    s = y["synthese"]
    proche(s["ms"]["m"], R["B11"], "MS")
    proche(s["commissions"]["m"], R["E11"], "commissions")
    proche(s["primes_total"]["m"], R["H11"], "primes")
    exclus = sum(D(str(t["m"])) for t in y["a_type_charge"] if t.get("exclu"))
    delta = D(str(s["absences"]["m"]))  # ecarts_connus : exclus_absences
    assert any(e["id"] == "exclus_absences" for e in ecarts)
    proche(exclus + delta, R["K11"], "exclusions (+ absences Excel)")
    proche(D(str(s["ms"]["m"])) + exclus + delta, R["K6"], "total avec exclusions")
    for i, ligne in enumerate(range(19, 31)):
        if f"F{ligne}" not in R:
            assert x6["serie_n"][i]["ms"] is None, ligne
            continue
        proche(x6["serie_n"][i]["ms"], R[f"F{ligne}"], ("MS mois", i + 1))
        proche(x6["serie_n"][i]["commissions"], R[f"J{ligne}"], ("commissions mois", i + 1))
