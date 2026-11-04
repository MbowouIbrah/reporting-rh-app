from app.models.auth import PreferenceUtilisateur

API = "/api/v1/auth/preferences"
ADMIN = "admin@exemple.invalid"


def test_preference_lue_ecrite_effacee(make_client, db):
    c = make_client(ADMIN)
    assert c.get(f"{API}/graphes.evolution").json() == {"valeur": None}
    r = c.put(f"{API}/graphes.evolution", json={"valeur": ["salaire", "ca", "salaire"]})
    assert r.status_code == 200 and r.json() == {"valeur": ["salaire", "ca"]}
    assert c.get(f"{API}/graphes.evolution").json() == {"valeur": ["salaire", "ca"]}
    assert c.get(f"{API}/graphes.autre").json() == {"valeur": None}
    c.put(f"{API}/graphes.evolution", json={"valeur": ["marge"]})
    assert c.get(f"{API}/graphes.evolution").json() == {"valeur": ["marge"]}
    assert c.put(f"{API}/graphes.evolution", json={"valeur": []}).json() == {"valeur": []}
    assert c.get(f"{API}/graphes.evolution").json() == {"valeur": []}
    assert db.query(PreferenceUtilisateur).count() == 1


def test_preference_propre_a_chaque_utilisateur(make_client):
    admin = make_client(ADMIN)
    pw = "<mot-de-passe-test>"
    r = admin.post("/api/v1/users", json={"email": "x@exemple.invalid", "nom": "X", "password": pw,
                                          "permissions": [], "portee": {"tout": True}})
    assert r.status_code in (200, 201), r.text
    admin.put(f"{API}/graphes.evolution", json={"valeur": ["ca"]})
    x = make_client("x@exemple.invalid")
    assert x.get(f"{API}/graphes.evolution").json() == {"valeur": None}


def test_preference_refusee(make_client):
    assert make_client().get(f"{API}/graphes.evolution").status_code == 401
    c = make_client(ADMIN)
    assert c.get(f"{API}/autre.cle").status_code == 422
    assert c.put(f"{API}/graphes.Evolution", json={"valeur": []}).status_code == 422
    assert c.put(f"{API}/graphes.evolution", json={"valeur": ["x"] * 51}).status_code == 422
    assert c.put(f"{API}/graphes.evolution", json={"valeur": ["x" * 51]}).status_code == 422
    assert c.put(f"{API}/graphes.evolution", json={"valeur": [""]}).status_code == 422
    assert c.put(f"{API}/graphes.evolution", json={"valeur": [3]}).status_code == 422


CONFIG = {
    "perso": [{"id": "p-1", "nom": "  Mes ventes ", "graphes": ["ca", "marge"]}],
    "ordre": ["ensemble", "p-1"],
    "defaut": "tout",
}


def test_groupes_lus_ecrits(make_client):
    c = make_client(ADMIN)
    assert c.get(f"{API}/groupes.evolution").json() == {"valeur": None}
    r = c.put(f"{API}/groupes.evolution", json={"valeur": CONFIG})
    attendu = {**CONFIG, "perso": [{"id": "p-1", "nom": "Mes ventes", "graphes": ["ca", "marge"]}]}
    assert r.status_code == 200 and r.json() == {"valeur": attendu}
    assert c.get(f"{API}/groupes.evolution").json() == {"valeur": attendu}
    assert c.get(f"{API}/graphes.evolution").json() == {"valeur": None}


def test_groupes_refuses(make_client):
    c = make_client(ADMIN)
    cinq = {**CONFIG, "perso": [{"id": "p-1", "nom": "X", "graphes": ["a", "b", "c", "d", "e"]}]}
    assert c.put(f"{API}/groupes.evolution", json={"valeur": cinq}).status_code == 422
    vide = {**CONFIG, "perso": [{"id": "p-1", "nom": "X", "graphes": []}]}
    assert c.put(f"{API}/groupes.evolution", json={"valeur": vide}).status_code == 422
    sans_nom = {**CONFIG, "perso": [{"id": "p-1", "nom": "   ", "graphes": ["ca"]}]}
    assert c.put(f"{API}/groupes.evolution", json={"valeur": sans_nom}).status_code == 422
    en_trop = {**CONFIG, "autre": 1}
    assert c.put(f"{API}/groupes.evolution", json={"valeur": en_trop}).status_code == 422
    assert c.put(f"{API}/groupes.evolution", json={"valeur": ["ca"]}).status_code == 422
    assert c.put(f"{API}/graphes.evolution", json={"valeur": CONFIG}).status_code == 422
    assert c.get(f"{API}/groupes.evolution").json() == {"valeur": None}
