from tests.test_donnees_api import ADMIN, API, BR, charger
from tests.test_import_regles import ligne

DRH = "drh@exemple.invalid"


def etapes(c, annee, mois):
    d = c.get(f"{API}/parcours", params={"annee": annee, "mois": mois}).json()
    return d, {e["cle"]: e["statut"] for e in d["etapes"]}


def test_droits(make_client):
    c = make_client(DRH)
    assert c.get(f"{API}/parcours", params={"annee": 2026, "mois": 1}).status_code == 403
    assert c.post(f"{API}/periodes", json={"annee": 2026, "mois": 5}).status_code == 403


def test_ouvrir_un_mois_puis_doublon(make_client):
    c = make_client(ADMIN)
    d, st = etapes(c, 2026, 5)
    assert d["existe"] is False and st["mois"] == "a_faire"
    r = c.post(f"{API}/periodes", json={"annee": 2026, "mois": 5})
    assert r.status_code == 201 and r.json()["statut"] == "ouverte"
    assert c.post(f"{API}/periodes", json={"annee": 2026, "mois": 5}).status_code == 409
    assert c.post(f"{API}/periodes", json={"annee": 2026, "mois": 13}).status_code == 422
    d, st = etapes(c, 2026, 5)
    assert d["existe"] and st["mois"] == "fait" and st["donnees"] == "a_faire"
    assert st["ca"] == "reportable" and st["budgets"] == "facultatif"


def test_effectifs_deduits_des_mois_et_ca_en_dernier(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: "100"}),
                ligne(MATRICULE="E2", Noms="Bob", **{BR: "100"})])
    charger(c, [ligne(MATRICULE="E2", Noms="Bob", MOIS="Février", **{BR: "100"}),
                ligne(MATRICULE="E3", Noms="Cy", MOIS="Février", **{BR: "100"})])
    d, st = etapes(c, 2026, 2)
    assert [x["matricule"] for x in d["effectifs"]["entrees"]] == ["E3"]
    assert [x["matricule"] for x in d["effectifs"]["sorties"]] == ["E1"]
    assert st["donnees"] == "fait" and st["controles"] in ("fait", "a_revoir")
    pid = d["periode_id"]
    assert c.put(f"{API}/periodes/{pid}/ca", json={"valeur": "5000"}).status_code == 200
    assert etapes(c, 2026, 2)[1]["ca"] == "fait"
