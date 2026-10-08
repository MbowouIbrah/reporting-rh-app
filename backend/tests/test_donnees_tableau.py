from decimal import Decimal as D

import pytest

from app.kpi.chargement import charger_periode, charger_tableau, options_tableau
from app.repos.scope import Scope
from tests.test_donnees_api import charger
from tests.test_rapports_api import ABS, ADMIN, API, BR, DRH, EQUIP, donnees

TOUT = Scope(True, {})


@pytest.fixture()
def admin(make_client):
    c = make_client(ADMIN)
    charger(c, donnees())
    return c


def tableau(c, **params):
    return c.get(f"{API}/donnees/tableau", params=params)


def test_droits(make_client):
    assert tableau(make_client()).status_code == 401
    assert tableau(make_client(DRH)).status_code == 403
    assert tableau(make_client(EQUIP)).status_code == 403


def test_contenu_et_calculs_en_chaines(admin):
    d = tableau(admin).json()
    cles = [(x["annee"], x["mois"], x["matricule"]) for x in d["lignes"]]
    assert cles == [(2026, 1, "E1"), (2026, 1, "E2"), (2026, 1, "E3"),
                    (2026, 2, "E1"), (2026, 2, "E2"), (2026, 2, "E4")]
    assert len(d["colonnes"]) == 17 and d["colonnes"][0] == ABS and BR in d["colonnes"]
    e1 = d["lignes"][0]
    assert e1["nom"] == "Ann" and e1["service"] == "SAV PL" and e1["site"] == "Douala"
    assert e1["montants"][BR] == "1000.500" and e1["montants"][ABS] == "2.000"
    # TOTAL CHARGES sans les rubriques exclues ; Total exclusions comme l'Excel (absences comprises)
    assert (e1["total"], e1["exclusions"]) == ("1000.500", "2.000")
    e2 = d["lignes"][4]
    assert (e2["total"], e2["exclusions"]) == ("2100.000", "999.000")
    assert "Bonus" not in e2["montants"]
    assert d["filtres"]["annees"] == [2026]
    assert d["filtres"]["services"] == ["Administration", "Commerce VN", "SAV PL"]
    assert d["filtres"]["sites"] == ["Douala", "Yaoundé"]
    # Employés enregistrés, un par matricule, triés par nom
    sal = d["filtres"]["salaries"]
    assert [s["nom"] for s in sal] == sorted(s["nom"] for s in sal)
    assert sorted(s["matricule"] for s in sal) == ["E1", "E2", "E3", "E4"]
    # Rubriques exclues du TOTAL, dans l'ordre des colonnes
    assert ABS in d["exclues"] and set(d["exclues"]) <= set(d["colonnes"])
    assert d["exclues"] == [c for c in d["colonnes"] if c in d["exclues"]]
    assert BR not in d["exclues"]


def test_filtres(admin):
    def mats(**p):
        return [(x["mois"], x["matricule"]) for x in tableau(admin, **p).json()["lignes"]]

    assert mats(mois=2) == [(2, "E1"), (2, "E2"), (2, "E4")]
    assert mats(annee=2026, mois=1, site="Yaoundé") == [(1, "E2"), (1, "E3")]
    assert mats(service="SAV PL") == [(1, "E1"), (2, "E1"), (2, "E4")]
    assert mats(q="e4") == [(2, "E4")]
    assert mats(q="bo") == [(1, "E2"), (2, "E2")]
    assert mats(q="_") == [] and mats(q="%") == []  # jokers SQL pris littéralement
    assert mats(matricule="E2") == [(1, "E2"), (2, "E2")]
    assert mats(matricule="e2") == [] and mats(matricule="E") == []  # égalité stricte
    vide = tableau(admin, annee=2025).json()
    assert vide["lignes"] == [] and vide["filtres"]["annees"] == [2026]
    assert tableau(admin, mois=13).status_code == 422


def test_perimetre_applique_dans_le_depot(admin, db):
    sav = charger_tableau(db, Scope(False, {"service": frozenset({"SAV PL"})}))
    assert {x["service"] for x in sav} == {"SAV PL"} and len(sav) == 3
    assert charger_tableau(db, Scope(False, {})) == []
    sal = options_tableau(db, Scope(False, {"service": frozenset({"SAV PL"})}))["salaries"]
    assert sorted(s["matricule"] for s in sal) == ["E1", "E4"]


def test_total_coherent_avec_le_moteur(admin, db):
    lignes = charger_tableau(db, TOUT)
    for mois in (1, 2):
        somme = sum(D(x["total"]) for x in lignes if x["mois"] == mois)
        assert somme == charger_periode(db, TOUT, 2026, mois).ms
