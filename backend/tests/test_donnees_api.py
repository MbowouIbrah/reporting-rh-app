import io

from openpyxl import load_workbook

from tests.test_import_regles import ligne, xlsx

API = "/api/v1"
ADMIN, DRH = "admin@exemple.invalid", "drh@exemple.invalid"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
BR = "Brut Réel"


def charger(c, lignes):
    lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(lignes), XLSX)}).json()
    assert lot["statut"] == "pret", lot
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200


def test_droits(make_client):
    c = make_client(DRH)
    assert c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).status_code == 403
    assert c.get(f"{API}/donnees/modele.xlsx", params={"annee": 2026, "mois": 1}).status_code == 403


def test_donnees_du_mois_et_fiche_creee_a_l_import(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: "1000.5"})])
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 1}).json()
    assert d["close"] is False and len(d["lignes"]) == 1
    assert d["lignes"][0]["montants"][BR] == "1000.500" and d["lignes"][0]["total"] == "1000.500"
    fiche = c.get(f"{API}/salaries").json()[0]
    assert fiche["matricule"] == "E1" and fiche["service"] == "SAV PL" and fiche["site"] == "Douala"
    vide = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 5}).json()
    assert vide["lignes"] == []


def test_modele_mensuel_aller_retour(make_client):
    c = make_client(ADMIN)
    charger(c, [ligne(MATRICULE="E1", Noms="Ann", **{BR: 1000})])
    r = c.get(f"{API}/donnees/modele.xlsx", params={"annee": 2026, "mois": 2})
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    ws = wb["DONNEES"]
    en = [x.value for x in ws[3]]
    assert en[:3] == ["ANNÉE", "MOIS", "MATRICULE"] and BR in en
    assert ws["A4"].value == 2026 and ws["B4"].value == "Février" and ws["C4"].value == "E1"
    ws.cell(4, en.index(BR) + 1, 1234)
    out = io.BytesIO()
    wb.save(out)
    lot = c.post(f"{API}/imports", files={"fichier": ("m.xlsx", out.getvalue(), XLSX)}).json()
    assert lot["statut"] == "pret" and lot["nb_bloquants"] == 0 and lot["nb_lignes"] == 1
    assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 2}).json()
    assert d["lignes"][0]["montants"][BR] == "1234.000"


def test_saisie_manuelle(make_client):
    c = make_client(ADMIN)
    corps = {"annee": 2026, "mois": 3, "matricule": "N1", "nom": "Neo", "poste": "P",
             "type_contrat": "CDI", "activite": "Front office", "site": "Douala",
             "service": "SAV PL", "montants": {BR: "500"}}
    r = c.post(f"{API}/donnees/lignes", json=corps)
    assert r.status_code == 201, r.text
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 3}).json()
    assert d["lignes"][0]["matricule"] == "N1" and d["lignes"][0]["montants"][BR] == "500.000"
    r = c.post(f"{API}/donnees/lignes", json={**corps, "matricule": "N2", "service": "Inconnu"})
    assert r.status_code == 422 and r.json()["detail"]["anomalies"]
    r = c.post(f"{API}/donnees/lignes", json={**corps, "montants": {BR: "700"}})
    assert r.status_code == 201
    d = c.get(f"{API}/donnees", params={"annee": 2026, "mois": 3}).json()
    assert len(d["lignes"]) == 1 and d["lignes"][0]["montants"][BR] == "700.000"
