API = "/api/v1"
ADMIN = "admin@exemple.invalid"
PW = "<mot-de-passe-test>"


def second_admin(c):
    r = c.post(f"{API}/users", json={"email": "a2@exemple.invalid", "nom": "A2", "password": PW,
                                     "roles": [{"role": "rh_admin"}]})
    assert r.status_code == 201
    return r.json()["id"]


def test_dernier_admin_actif_protege(db, make_client):
    c = make_client(ADMIN)
    moi = c.get(f"{API}/auth/me").json()["id"]
    # seul admin : désactivation et retrait du rôle refusés
    assert c.put(f"{API}/users/{moi}", json={"actif": False}).status_code == 409
    assert c.put(f"{API}/users/{moi}", json={"roles": [{"role": "lecteur_global"}]}
                 ).status_code == 409
    # avec un second admin : possible
    autre = second_admin(c)
    assert c.put(f"{API}/users/{autre}", json={"actif": False}).status_code == 200
    # le second est inactif : le premier redevient le dernier
    assert c.put(f"{API}/users/{moi}", json={"actif": False}).status_code == 409
    # suppression d'un admin inactif : autorisée
    assert c.delete(f"{API}/users/{autre}").status_code == 204


def test_audit_filtres_et_pagination(db, make_client):
    c = make_client(ADMIN)
    uid = second_admin(c)
    c.put(f"{API}/users/{uid}", json={"nom": "B"})
    tout = c.get(f"{API}/audit").json()
    u = c.get(f"{API}/audit", params={"entite": "utilisateur", "entite_id": uid}).json()
    assert len(u) == 2 and all(e["entite_id"] == str(uid) for e in u)
    page = c.get(f"{API}/audit", params={"limit": 1, "offset": 1}).json()
    assert [e["id"] for e in page] == [tout[1]["id"]]


def test_creation_email_invalide_refusee(db, make_client):
    c = make_client(ADMIN)
    for email in ["pas-un-email", "a@b", "a b@exemple.invalid", "@exemple.invalid"]:
        r = c.post(f"{API}/users", json={"email": email, "nom": "X", "password": PW,
                                         "roles": [{"role": "lecteur_global"}]})
        assert r.status_code == 422, email


def test_modification_email(db, make_client):
    c = make_client(ADMIN)
    uid = second_admin(c)
    r = c.put(f"{API}/users/{uid}", json={"email": " Nouveau@exemple.invalid "})
    assert r.status_code == 200 and r.json()["email"] == "nouveau@exemple.invalid"
    assert c.put(f"{API}/users/{uid}", json={"email": "a@b"}).status_code == 422
    assert c.put(f"{API}/users/{uid}", json={"email": ADMIN}).status_code == 409
    # le changement d'adresse ne touche pas le reste du compte
    assert c.put(f"{API}/users/{uid}", json={"nom": "B"}).json()["email"] == "nouveau@exemple.invalid"
