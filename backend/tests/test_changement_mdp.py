"""Mot de passe provisoire : tout est bloqué au serveur jusqu'au changement."""

import pytest
from fastapi.routing import APIRoute
from sqlalchemy import select

from app import seed
from app.core.config import settings
from app.main import app
from app.models.auth import AuditEvent, Utilisateur
from app.security.deps import current_principal, session_principal
from app.security.passwords import verify_password
from app.security.tokens import empreinte, make_token
from app.seed import _user, run
from tests.conftest import PW
from tests.identites import DOMAINE, courriel, mot_de_passe

ADMIN = courriel("admin")
NOUVEAU = mot_de_passe()
AUTRE = mot_de_passe()
DEMO = mot_de_passe()
CHANGER = "/api/v1/auth/changer-mot-de-passe"
LECTEUR = {"permissions": [], "portee": {"tout": True}}


def provisoire(db, email=ADMIN) -> Utilisateur:
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
    u.doit_changer_mdp = True
    db.commit()
    return u


def _deps(dep) -> set:
    return {dep.call} | {x for d in dep.dependencies for x in _deps(d)}


def _routes(routes, prefixe=""):
    """Toutes les routes de l'application, en descendant dans les routeurs inclus."""
    for r in routes:
        inclus = getattr(r, "original_router", None)
        if inclus is not None:
            yield from _routes(inclus.routes, prefixe + r.include_context.prefix)
        elif isinstance(r, APIRoute):
            yield prefixe + r.path, r


def test_le_demarrage_cree_un_admin_provisoire_sans_le_remettre_ensuite(db):
    for u in db.scalars(select(Utilisateur)):
        u.actif = False
    db.commit()
    run(db, courriel("neuf"), PW, None)
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == courriel("neuf")))
    assert u.doit_changer_mdp is True
    u.doit_changer_mdp = False
    db.commit()
    run(db, courriel("neuf"), AUTRE, None)
    db.refresh(u)
    assert u.doit_changer_mdp is False


def test_pas_de_nouvel_admin_si_un_gestionnaire_actif_existe(db):
    run(db, courriel("second"), PW, None)
    assert db.scalar(select(Utilisateur).where(Utilisateur.email == courriel("second"))) is None


def test_comptes_d_exemple_provisoires_et_refuses_en_production(db, monkeypatch):
    assert _user(db, courriel("defaut"), "Défaut", PW, "global") is None
    db.flush()
    assert db.scalar(select(Utilisateur).where(Utilisateur.email == courriel("defaut"))).doit_changer_mdp is True
    drh = db.scalar(select(Utilisateur).where(Utilisateur.email == courriel("drh")))
    drh.email = courriel("ancien")
    db.commit()
    run(db, ADMIN, PW, DEMO, demo_domaine=DOMAINE)
    assert db.scalar(select(Utilisateur).where(Utilisateur.email == courriel("drh"))).doit_changer_mdp is True
    assert seed.mot_de_passe_demo(["seed"]) is None
    monkeypatch.setenv("DEMO_PASSWORD", "court")
    with pytest.raises(SystemExit):
        seed.mot_de_passe_demo(["seed", "--demo"])
    monkeypatch.setenv("DEMO_PASSWORD", DEMO)
    assert seed.mot_de_passe_demo(["seed", "--demo"]) == DEMO
    monkeypatch.setattr(settings, "ENV", "prod")
    with pytest.raises(SystemExit):
        seed.mot_de_passe_demo(["seed", "--demo"])


def test_mot_de_passe_d_amorcage_suit_les_regles_de_l_api(monkeypatch):
    for refuse in (" " * 10, "é" * 40):
        monkeypatch.setenv("DEMO_PASSWORD", refuse)
        with pytest.raises(SystemExit):
            seed.mot_de_passe_demo(["seed", "--demo"])


def test_admin_existant_sans_droit_est_signale(db, capsys):
    for u in db.scalars(select(Utilisateur)):
        u.actif = False
    db.commit()
    run(db, ADMIN, PW, None)
    assert f"{ADMIN} existe déjà" in capsys.readouterr().err
    assert db.scalar(select(Utilisateur).where(Utilisateur.email == ADMIN)).actif is False


def test_routes_bloquees_et_routes_ouvertes(db, make_client):
    provisoire(db)
    c = make_client(ADMIN)
    me = c.get("/api/v1/auth/me")
    assert me.status_code == 200 and me.json()["doit_changer_mdp"] is True
    for url in ("/api/v1/users", "/api/v1/rapports/periodes", "/api/v1/auth/preferences/graphes.resume"):
        r = c.get(url)
        assert r.status_code == 403, url
        assert r.json()["detail"]["code"] == "mot_de_passe_a_changer"
    assert c.post("/api/v1/auth/refresh").status_code == 200
    assert c.get("/api/v1/users").status_code == 403
    assert c.post("/api/v1/auth/logout").status_code == 200


def test_toute_route_passe_par_la_porte_sauf_les_routes_prevues():
    ouvertes, publiques = set(), set()
    routes = list(_routes(app.routes))
    assert len(routes) > 50
    for chemin, r in routes:
        deps = _deps(r.dependant)
        if current_principal in deps:
            continue
        (ouvertes if session_principal in deps else publiques).add(chemin)
    assert ouvertes == {"/api/v1/auth/me", CHANGER}
    assert publiques == {"/health", "/health/ready"} | {f"/api/v1/auth/{x}" for x in (
        "login", "refresh", "mot-de-passe-oublie", "reinitialiser", "logout")}


def test_changement_refuse(db, make_client):
    u = provisoire(db)
    c = make_client(ADMIN)
    assert c.post(CHANGER, json={"actuel": mot_de_passe(), "nouveau": NOUVEAU}).status_code == 400
    assert c.post(CHANGER, json={"actuel": PW, "nouveau": "court"}).status_code == 422
    assert c.post(CHANGER, json={"actuel": PW, "nouveau": PW}).status_code == 422
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "changement_mdp_refuse")) is not None
    assert c.post(CHANGER, json={"actuel": PW, "nouveau": " " * 10}).status_code == 422
    assert c.post(CHANGER, json={"actuel": PW, "nouveau": "é" * 40}).status_code == 422
    db.refresh(u)
    assert u.doit_changer_mdp is True
    assert c.get("/api/v1/users").status_code == 403
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "changement_mdp_echec")) is not None


def test_changement_debloque_et_ferme_les_autres_sessions(db, make_client):
    provisoire(db)
    c, autre, autre_refresh = make_client(ADMIN), make_client(ADMIN), make_client(ADMIN)
    r = c.post(CHANGER, json={"actuel": PW, "nouveau": NOUVEAU})
    assert r.status_code == 200 and r.json()["doit_changer_mdp"] is False
    assert c.get("/api/v1/users").status_code == 200
    autre.cookies.delete("refresh_token")
    assert autre.get("/api/v1/auth/me").status_code == 401
    assert autre_refresh.post("/api/v1/auth/refresh").status_code == 401
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "changement_mdp")) is not None
    assert make_client().post("/api/v1/auth/login", json={"email": ADMIN, "password": PW}).status_code == 401
    assert make_client().post("/api/v1/auth/login", json={"email": ADMIN, "password": NOUVEAU}).status_code == 200


def test_le_changement_garde_le_choix_rester_connecte(db, make_client):
    provisoire(db)
    c = make_client()
    assert c.post("/api/v1/auth/login", json={"email": ADMIN, "password": PW, "remember": True}).status_code == 200
    r = c.post(CHANGER, json={"actuel": PW, "nouveau": NOUVEAU})
    cookie = next(s for s in r.headers.get_list("set-cookie") if s.startswith("refresh_token="))
    assert f"Max-Age={settings.REFRESH_TOKEN_DAYS * 86400}" in cookie


def test_changement_sans_session(make_client):
    assert make_client().post(CHANGER, json={"actuel": PW, "nouveau": NOUVEAU}).status_code == 401


def test_admin_pose_un_mot_de_passe_provisoire_mais_pas_sur_son_compte(db, make_client):
    c = make_client(ADMIN)
    cree = c.post("/api/v1/users", json={"email": courriel("n"), "nom": "N", "password": PW, **LECTEUR})
    assert cree.status_code == 201, cree.text
    u = db.get(Utilisateur, cree.json()["id"])
    assert u.doit_changer_mdp is True
    u.doit_changer_mdp = False
    db.commit()
    assert c.put(f"/api/v1/users/{u.id}", json={"nom": "N2"}).status_code == 200
    db.refresh(u)
    assert u.doit_changer_mdp is False
    assert c.put(f"/api/v1/users/{u.id}", json={"password": NOUVEAU}).status_code == 200
    db.refresh(u)
    assert u.doit_changer_mdp is True
    moi = db.scalar(select(Utilisateur).where(Utilisateur.email == ADMIN))
    assert c.put(f"/api/v1/users/{moi.id}", json={"password": NOUVEAU}).status_code == 422
    db.refresh(moi)
    assert moi.doit_changer_mdp is False and verify_password(PW, moi.password_hash)
    assert c.get("/api/v1/users").json()[0].keys() >= {"doit_changer_mdp"}


def test_le_lien_de_reinitialisation_efface_le_drapeau(db, make_client):
    u = provisoire(db)
    jeton = make_token(u.id, "reset", pwd=empreinte(u.password_hash))
    r = make_client().post("/api/v1/auth/reinitialiser", json={"jeton": jeton, "password": NOUVEAU})
    assert r.status_code == 200
    db.refresh(u)
    assert u.doit_changer_mdp is False


def test_le_lien_refuse_le_mot_de_passe_actuel(db, make_client):
    u = provisoire(db)
    jeton = make_token(u.id, "reset", pwd=empreinte(u.password_hash))
    c = make_client()
    assert c.post("/api/v1/auth/reinitialiser", json={"jeton": jeton, "password": PW}).status_code == 422
    db.refresh(u)
    assert u.doit_changer_mdp is True
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "reinit_mdp_refuse")) is not None
    assert c.post("/api/v1/auth/reinitialiser", json={"jeton": jeton, "password": NOUVEAU}).status_code == 200
