import io

from openpyxl import Workbook, load_workbook

API = "/api/v1/salaries"
ADMIN, DRH = "admin@exemple.invalid", "drh@exemple.invalid"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def fichier(lignes):
    wb = Workbook()
    ws = wb.active
    ws.title = "EMPLOYES"
    ws.append(["Matricule", "Noms", "Poste", "Type Contrat", "Activité", "Site", "Service", "Actif"])
    for r in lignes:
        ws.append(r)
    out = io.BytesIO()
    wb.save(out)
    return out.getvalue()


def test_droits(make_client):
    assert make_client(DRH).get(API).status_code == 403


def test_creer_modifier_et_liste(make_client):
    c = make_client(ADMIN)
    r = c.post(API, json={"matricule": "E9", "nom": "Zoe", "service": "sav pl", "site": "Yaoundé"})
    assert r.status_code == 201 and r.json()["service"] == "SAV PL"
    assert c.post(API, json={"matricule": "e9", "nom": "X"}).status_code == 409
    assert c.post(API, json={"matricule": "E8", "nom": "X", "site": "Mars"}).status_code == 422
    r = c.put(f"{API}/{r.json()['id']}", json={"matricule": "E9", "nom": "Zoé", "actif": False})
    assert r.json()["nom"] == "Zoé" and r.json()["service"] is None and r.json()["actif"] is False
    assert [x["matricule"] for x in c.get(API).json()] == ["E9"]


def test_modele_telechargeable(make_client):
    r = make_client(ADMIN).get(f"{API}/modele.xlsx")
    assert r.status_code == 200
    wb = load_workbook(io.BytesIO(r.content))
    assert wb["EMPLOYES"]["A3"].value == "Matricule" and wb["LISTES"].sheet_state == "hidden"


def test_import_simulation_puis_reel(make_client):
    c = make_client(ADMIN)
    f = fichier([["A1", "Ann", None, None, None, None, "SAV PL", "Oui"], ["A2", "Bob", None, None, None, None, None, "Non"]])
    r = c.post(f"{API}/import", files={"fichier": ("e.xlsx", f, XLSX)})
    assert r.json()["crees"] == 2 and r.json()["simulation"] is True and c.get(API).json() == []
    r = c.post(f"{API}/import?simuler=false", files={"fichier": ("e.xlsx", f, XLSX)})
    assert r.json()["crees"] == 2 and len(c.get(API).json()) == 2
    f = fichier([["A1", "Ann B", None, None, None, None, None, "Oui"]])
    r = c.post(f"{API}/import?simuler=false", files={"fichier": ("e.xlsx", f, XLSX)})
    assert r.json() == {"simulation": False, "crees": 0, "modifies": 1, "anomalies": []}


def test_import_anomalies_tout_ou_rien(make_client):
    c = make_client(ADMIN)
    f = fichier([["B1", "Ok", None, None, None, "Nulle part", None, None], ["", "Sans mat", None, None, None, None, None, None]])
    r = c.post(f"{API}/import", files={"fichier": ("e.xlsx", f, XLSX)})
    assert len(r.json()["anomalies"]) == 2
    r = c.post(f"{API}/import?simuler=false", files={"fichier": ("e.xlsx", f, XLSX)})
    assert r.status_code == 422 and c.get(API).json() == []
