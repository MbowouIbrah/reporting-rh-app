from tests.test_donnees_api import ADMIN, API, BR, XLSX, charger
from tests.test_import_regles import ligne, xlsx

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
    assert r.status_code == 201 and r.json()["mois"]
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
    assert st["donnees"] == "fait"
    assert (st["controles"] == "a_revoir") == bool(d["ecarts"])
    pid = d["periode_id"]
    assert c.put(f"{API}/periodes/{pid}/ca", json={"valeur": "5000"}).status_code == 200
    d, st = etapes(c, 2026, 2)
    assert st["ca"] == "reportable" and "marge à saisir" in d["etapes"][3]["resume"]
    r = c.put(f"{API}/pilotage/ca-marge",
              json={"annee": 2026, "mois": 2, "ca": "5000", "marge": "800"})
    assert r.status_code == 200, r.text
    assert etapes(c, 2026, 2)[1]["ca"] == "fait"


def test_lot_en_attente_a_revoir_et_budgets_faits(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: "100"})])
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(
        [ligne(MATRICULE="E2", Noms="Bob", **{BR: "200"})]), XLSX)}).json()
    assert lot["statut"] == "pret"
    d, st = etapes(c, 2026, 1)
    assert st["donnees"] == "a_revoir" and d["etapes"][1]["resume"].startswith("1 import(s)")
    pid = d["periode_id"]
    assert st["budgets"] == "facultatif"
    rub = c.get(f"{API}/budgets", params={"periode_id": pid}).json()["lignes"]["rubrique"]
    cible = next(x["cible_id"] for x in rub)
    r = c.put(f"{API}/budgets/{pid}", json={"lignes": [
        {"axe": "rubrique", "cible_id": cible, "valeur": "10"}]})
    assert r.status_code == 200, r.text
    assert etapes(c, 2026, 1)[1]["budgets"] == "fait"


def test_mois_non_ouvert_donne_une_consigne_par_etape(make_client):
    d, _ = etapes(make_client(ADMIN), 2030, 3)
    assert all(e["resume"] not in ("", "—") for e in d["etapes"]) and d["ecarts"] == []
