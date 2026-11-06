from app.security.policy import ACCORDABLES
from tests.conftest import PW, mot_de_passe_choisi
from tests.identites import DOMAINE, courriel

API = "/api/v1"
ADMIN = courriel("admin")
ADMIN_DROITS = {"permissions": list(ACCORDABLES), "portee": {"tout": True}}
GLOBAL_DROITS = {"permissions": ["nominatif", "marge"], "portee": {"tout": True}}


def second_admin(c):
    r = c.post(f"{API}/users", json={"email": courriel("a2"), "nom": "A2", "password": PW,
                                     **ADMIN_DROITS})
    assert r.status_code == 201
    return r.json()["id"]


def test_dernier_admin_actif_protege(db, make_client):
    c = make_client(ADMIN)
    moi = c.get(f"{API}/auth/me").json()["id"]
    # seul admin : désactivation et retrait du rôle refusés
    assert c.put(f"{API}/users/{moi}", json={"actif": False}).status_code == 409
    assert c.put(f"{API}/users/{moi}", json=GLOBAL_DROITS).status_code == 409
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
    for email in ["pas-un-email", "a@b", f"a b@{DOMAINE}", f"@{DOMAINE}"]:
        r = c.post(f"{API}/users", json={"email": email, "nom": "X", "password": PW,
                                         **GLOBAL_DROITS})
        assert r.status_code == 422, email


def test_modification_email(db, make_client):
    c = make_client(ADMIN)
    uid = second_admin(c)
    r = c.put(f"{API}/users/{uid}", json={"email": f" Nouveau@{DOMAINE.upper()} "})
    assert r.status_code == 200 and r.json()["email"] == courriel("nouveau")
    assert c.put(f"{API}/users/{uid}", json={"email": "a@b"}).status_code == 422
    assert c.put(f"{API}/users/{uid}", json={"email": ADMIN}).status_code == 409
    # le changement d'adresse ne touche pas le reste du compte
    assert c.put(f"{API}/users/{uid}", json={"nom": "B"}).json()["email"] == courriel("nouveau")


def test_retrait_de_sa_propre_gestion_refuse_meme_avec_un_autre_admin(db, make_client):
    c = make_client(ADMIN)
    moi = c.get(f"{API}/auth/me").json()["id"]
    second_admin(c)
    r = c.put(f"{API}/users/{moi}", json=GLOBAL_DROITS)
    assert r.status_code == 409
    # restreindre ses propres données retire aussi la gestion des comptes
    assert c.put(f"{API}/users/{moi}", json={"portee": {"perimetres": [1]}}).status_code == 422


def test_droits_valides(db, make_client):
    c = make_client(ADMIN)
    base = {"email": courriel("v"), "nom": "V", "password": PW}
    pid = c.get(f"{API}/perimetres").json()[0]["id"]
    # permission d'écriture sans « toutes les données » : refusée
    r = c.post(f"{API}/users", json={**base, "permissions": ["import"],
                                     "portee": {"perimetres": [pid]}})
    assert r.status_code == 422 and "toutes les données" in r.json()["detail"]
    assert c.post(f"{API}/users", json={**base, "permissions": ["inconnue"]}).status_code == 422
    assert c.post(f"{API}/users", json={**base, "portee": {"perimetres": [9999]}}
                  ).status_code == 422
    assert c.post(f"{API}/users", json={**base, "portee": {"services": ["Inexistant"]}}
                  ).status_code == 422
    r = c.post(f"{API}/users", json={**base, "fonction": " Chef ", "permissions": ["nominatif"],
                                     "portee": {"services": ["SAV PL", "SAV PL"],
                                                "sites": ["Douala"]}})
    assert r.status_code == 201, r.text
    u = r.json()
    assert u["fonction"] == "Chef" and u["permissions"] == ["nominatif"]
    assert u["portee"] == {"tout": False, "perimetres": [], "services": ["SAV PL"],
                           "sites": ["Douala"]}


def test_journal_exige_toutes_les_donnees(db, make_client):
    c = make_client(ADMIN)
    pid = c.get(f"{API}/perimetres").json()[0]["id"]
    r = c.post(f"{API}/users", json={"email": courriel("j"), "nom": "J", "password": PW,
                                     "permissions": ["journal"],
                                     "portee": {"perimetres": [pid]}})
    assert r.status_code == 422 and "toutes les données" in r.json()["detail"]


def test_portee_directe_suit_le_renommage(db, make_client):
    from sqlalchemy import select

    from app.models.referentiel import Service

    c = make_client(ADMIN)
    r = c.post(f"{API}/users", json={"email": courriel("s"), "nom": "S", "password": PW,
                                     "portee": {"services": ["SAV PL"]}})
    uid = r.json()["id"]
    rid = db.scalar(select(Service.id).where(Service.libelle == "SAV PL"))
    url = f"{API}/referentiels/service/{rid}"
    apercu = c.put(url, params={"apercu": True}, json={"libelle": "SAV Poids Lourds"}).json()
    assert apercu["comptes_maj"] == 1
    assert c.put(url, json={"libelle": "SAV Poids Lourds"}).json()["comptes_maj"] == 1
    u = c.get(f"{API}/users").json()
    assert next(x for x in u if x["id"] == uid)["portee"]["services"] == ["SAV Poids Lourds"]
    # la portée reste valide : une modification des seules permissions passe
    assert c.put(f"{API}/users/{uid}", json={"permissions": ["nominatif"]}).status_code == 200


def test_perimetre_une_dimension_et_suppression_si_inutilise(db, make_client):
    c = make_client(ADMIN)
    mixte = {"code": "mx", "libelle": "Mixte", "regles": [
        {"dimension": "service", "valeur": "SAV PL"}, {"dimension": "site", "valeur": "Douala"}]}
    assert c.post(f"{API}/perimetres", json=mixte).status_code == 422
    r = c.post(f"{API}/perimetres", json={**mixte, "regles": mixte["regles"][1:]})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    c.post(f"{API}/users", json={"email": courriel("p"), "nom": "P", "password": PW,
                                 "portee": {"perimetres": [pid]}})
    r = c.delete(f"{API}/perimetres/{pid}")
    assert r.status_code == 409 and courriel("p") in r.json()["detail"]


def test_gestionnaire_de_comptes_liste_services_et_sites(db, make_client):
    c = make_client(ADMIN)
    r = c.post(f"{API}/users", json={"email": courriel("g"), "nom": "G", "password": PW,
                                     "permissions": ["comptes"], "portee": {"tout": True}})
    assert r.status_code == 201
    mot_de_passe_choisi(db, courriel("g"))
    g = make_client(courriel("g"))
    r = g.get(f"{API}/referentiels/service")
    assert r.status_code == 200 and "alias" not in r.json()
    assert g.get(f"{API}/referentiels/site").status_code == 200
    assert g.get(f"{API}/referentiels/rubrique").status_code == 403
    assert g.get(f"{API}/referentiels/poste").status_code == 403
    lecteur = c.post(f"{API}/users", json={"email": courriel("l"), "nom": "L", "password": PW,
                                           **GLOBAL_DROITS})
    assert lecteur.status_code == 201
    mot_de_passe_choisi(db, courriel("l"))
    assert make_client(courriel("l")).get(f"{API}/referentiels/site").status_code == 403
