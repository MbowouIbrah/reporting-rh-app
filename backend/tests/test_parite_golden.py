"""Parité sur les 18 périodes de la V4 avec le golden relevé par tools/golden_lo.py."""

import json
from pathlib import Path

import pytest

from tests import test_parite_v4 as pv
from tests.test_import_regles import V4
from tests.test_parite_v4 import API, XLSX

GOLDEN = Path(__file__).parents[2] / "golden" / "lo_v4.json"
pytestmark = pytest.mark.skipif(
    not GOLDEN.exists() or not V4.exists(), reason="golden et fichier V4 requis")
VERIF = (pv.test_bloc_a_type_de_charge, pv.test_bloc_b_service_activite, pv.test_bloc_c_site,
         pv.test_bloc_d_contrat, pv.test_effectifs_rotation_absences)


def test_parite_18_periodes(make_client):
    golden = json.loads(GOLDEN.read_text(encoding="utf-8"))
    assert len(golden) == 18
    c = make_client("admin@exemple.invalid")
    lot = c.post(f"{API}/imports", files={"fichier": ("v4.xlsx", V4.read_bytes(), XLSX)}).json()
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    for cle, feuilles in sorted(golden.items()):
        annee, mois = map(int, cle.split("-"))
        r = c.get(f"{API}/rapports/mensuel", params={"annee": annee, "mois": mois})
        assert r.status_code == 200, (cle, r.text)
        rapport = r.json()
        assert all(not x["bloquant"] for x in rapport["controles"]), cle
        for verif in VERIF:
            try:
                verif(rapport, feuilles["mensuel"])
            except AssertionError as e:
                raise AssertionError(f"{cle} {verif.__name__}: {e}") from e
