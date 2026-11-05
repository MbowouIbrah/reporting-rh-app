from app.models.auth import AuditEvent
from tests.conftest import mot_de_passe_choisi

API = "/api/v1/reglages/noms_groupes"
ADMIN = "admin@exemple.invalid"
PW = "<mot-de-passe-test>"


def _lecteur(admin):
    r = admin.post("/api/v1/users", json={"email": "lecteur@exemple.invalid", "nom": "Lecteur", "password": PW,
                                          "permissions": [], "portee": {"tout": True}})
    assert r.status_code in (200, 201), r.text


def test_reglage_vide_par_defaut(make_client):
    assert make_client(ADMIN).get(API).json() == {"valeur": {}}


def test_admin_ecrit_et_un_autre_utilisateur_lit(make_client, db):
    admin = make_client(ADMIN)
    r = admin.put(API, json={"valeur": {"ventes": "  Nouveau nom ", "ensemble": "Autre"}})
    assert r.status_code == 200
    attendu = {"valeur": {"ventes": "Nouveau nom", "ensemble": "Autre"}}
    assert r.json() == attendu
    _lecteur(admin)
    mot_de_passe_choisi(db, "lecteur@exemple.invalid")
    lecteur = make_client("lecteur@exemple.invalid")
    assert lecteur.get(API).json() == attendu
    assert admin.put(API, json={"valeur": {}}).json() == {"valeur": {}}
    assert lecteur.get(API).json() == {"valeur": {}}
    assert db.query(AuditEvent).filter(AuditEvent.entite == "reglage").count() == 2


def test_non_admin_ne_peut_pas_ecrire(make_client):
    admin = make_client(ADMIN)
    _lecteur(admin)
    lecteur = make_client("lecteur@exemple.invalid")
    assert lecteur.put(API, json={"valeur": {"ventes": "X"}}).status_code == 403
    assert admin.get(API).json() == {"valeur": {}}
    assert make_client().get(API).status_code == 401


def test_valeurs_refusees(make_client):
    c = make_client(ADMIN)
    assert c.put(API, json={"valeur": {"ventes": ""}}).status_code == 422
    assert c.put(API, json={"valeur": {"ventes": "   "}}).status_code == 422
    assert c.put(API, json={"valeur": {"ventes": "x" * 61}}).status_code == 422
    assert c.put(API, json={"valeur": {"Ventes": "X"}}).status_code == 422
    assert c.put(API, json={"valeur": {"a" * 31: "X"}}).status_code == 422
    assert c.put(API, json={"valeur": {"v1": "X"}}).status_code == 422
    assert c.put(API, json={"valeur": {"a" * i: "X" for i in range(1, 22)}}).status_code == 422
    assert c.put(API, json={"valeur": {"ventes": 3}}).status_code == 422
    assert c.put(API, json={"valeur": {"ventes": "x" * 60}}).status_code == 200


def test_cle_inconnue(make_client):
    c = make_client(ADMIN)
    assert c.get("/api/v1/reglages/autre").status_code == 404
    assert c.put("/api/v1/reglages/autre", json={"valeur": {}}).status_code == 404
