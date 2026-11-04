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
