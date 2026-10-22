import logging
import re
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app import mail
from app.core.config import settings
from app.models.auth import AuditEvent, Utilisateur
from app.security.tokens import empreinte, make_token
from tests.conftest import PW

API = "/api/v1"
ADMIN = "admin@exemple.invalid"
DRH = "drh@exemple.invalid"
NOUVEAU = "<mot-de-passe-test-n9>"
LOGGER = "app.api.auth"


def _login(c, remember):
    r = c.post(f"{API}/auth/login", json={"email": DRH, "password": PW, "remember": remember})
    assert r.status_code == 200, r.text
    return {s.split("=", 1)[0]: s for s in r.headers.get_list("set-cookie")}


def _oubli(c, email=DRH):
    return c.post(f"{API}/auth/mot-de-passe-oublie", json={"email": email})


def _jeton(caplog):
    liens = [m.group(1) for r in caplog.records if (m := re.search(r"jeton=(\S+)", r.getMessage()))]
    assert liens, "aucun lien dans le journal"
    return liens[-1]


def _jeton_reset(db, email=DRH, **claims):
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
    return make_token(u.id, "reset", pwd=empreinte(u.password_hash), **claims)


def _reinit(c, jeton, password=NOUVEAU):
    return c.post(f"{API}/auth/reinitialiser", json={"jeton": jeton, "password": password})


@pytest.fixture()
def admin_change_mdp(make_client):
    def _go(email=DRH, mdp=NOUVEAU):
        admin, user = make_client(ADMIN), make_client(email)
        uid = user.get(f"{API}/auth/me").json()["id"]
        assert admin.put(f"{API}/users/{uid}", json={"password": mdp}).status_code == 200
        return user

    return _go


# Se souvenir de moi

def test_sans_remember_cookies_de_session(make_client):
    cookies = _login(make_client(), False)
    assert len(cookies) == 2
    assert all("max-age" not in s.lower() for s in cookies.values())


def test_avec_remember_cookies_persistants(make_client):
    cookies = _login(make_client(), True)
    assert f"Max-Age={settings.REFRESH_TOKEN_DAYS * 86400}" in cookies["refresh_token"]
    assert f"Max-Age={settings.ACCESS_TOKEN_MINUTES * 60}" in cookies["access_token"]


def test_refresh_garde_le_choix_remember(make_client):
    c = make_client()
    _login(c, False)
    r = c.post(f"{API}/auth/refresh")
    assert r.status_code == 200
    assert all("max-age" not in s.lower() for s in r.headers.get_list("set-cookie"))
    _login(c, True)
    r = c.post(f"{API}/auth/refresh")
    assert all("max-age" in s.lower() for s in r.headers.get_list("set-cookie"))


def test_refresh_refuse_apres_changement_de_mot_de_passe(admin_change_mdp):
    user = admin_change_mdp()
    assert user.post(f"{API}/auth/refresh").status_code == 401


def test_session_ouverte_fermee_apres_changement_de_mot_de_passe(admin_change_mdp):
    user = admin_change_mdp()
    assert user.get(f"{API}/auth/me").status_code == 401


def test_jeton_reset_refuse_comme_cookie_de_session(make_client, db):
    c = make_client()
    c.cookies.set("access_token", _jeton_reset(db))
    assert c.get(f"{API}/auth/me").status_code == 401
    c.cookies.clear()
    c.cookies.set("refresh_token", _jeton_reset(db))
    assert c.post(f"{API}/auth/refresh").status_code == 401


# Mot de passe oublié

def test_oubli_reponse_identique_compte_inconnu(make_client, caplog):
    c = make_client()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        connu, inconnu = _oubli(c), _oubli(c, "inconnu@exemple.invalid")
    assert connu.status_code == inconnu.status_code == 200
    assert connu.json() == inconnu.json() == {"status": "ok"}
    assert len([r for r in caplog.records if "jeton=" in r.getMessage()]) == 1


def test_oubli_compte_inactif_ignore(make_client, caplog):
    admin, drh = make_client(ADMIN), make_client(DRH)
    uid = drh.get(f"{API}/auth/me").json()["id"]
    admin.put(f"{API}/users/{uid}", json={"actif": False})
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        assert _oubli(make_client()).json() == {"status": "ok"}
    assert not [r for r in caplog.records if "jeton=" in r.getMessage()]


def test_oubli_limite_cinq_minutes(make_client, db, caplog):
    c = make_client()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        _oubli(c)
        r = _oubli(c)
    assert r.json() == {"status": "ok"}
    assert len([x for x in caplog.records if "jeton=" in x.getMessage()]) == 1
    actions = db.scalars(select(AuditEvent.action).where(AuditEvent.action.like("reinit_%"))).all()
    assert actions.count("reinit_demande") == 1 and actions.count("reinit_non_envoye") == 1
    # Passé 5 minutes, une nouvelle demande est acceptée.
    for ev in db.scalars(select(AuditEvent).where(AuditEvent.action == "reinit_demande")):
        ev.ts = datetime.now(UTC) - timedelta(minutes=6)
    db.commit()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        _oubli(c)
    assert len([x for x in caplog.records if "jeton=" in x.getMessage()]) == 2


def test_oubli_envoie_le_mail_sans_ecrire_le_lien(make_client, monkeypatch, caplog):
    envois = []
    monkeypatch.setattr(mail, "envoyer", lambda d, s, t: envois.append((d, s, t)) or True)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        assert _oubli(make_client()).status_code == 200
    assert len(envois) == 1 and envois[0][0] == DRH
    assert f"{settings.APP_URL}/reinitialiser#jeton=" in envois[0][2]
    assert not [r for r in caplog.records if "jeton=" in r.getMessage()]


def test_oubli_erreur_smtp_jamais_remontee(make_client, monkeypatch, caplog):
    def casse(*_):
        raise OSError("smtp indisponible")

    monkeypatch.setattr(mail, "envoyer", casse)
    monkeypatch.setattr(settings, "SMTP_HOST", "smtp.test")
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        r = _oubli(make_client())
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_oubli_en_prod_sans_smtp_pas_de_lien_dans_le_journal(make_client, monkeypatch, caplog):
    monkeypatch.setattr(settings, "ENV", "prod")
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        assert _oubli(make_client()).status_code == 200
    assert not [r for r in caplog.records if "jeton=" in r.getMessage()]


def test_mail_sans_serveur_renvoie_false(monkeypatch):
    monkeypatch.setattr(settings, "SMTP_HOST", "")
    assert mail.envoyer("a@exemple.invalid", "s", "t") is False


# Réinitialisation

def test_reinit_succes_puis_jeton_reutilise(make_client, caplog):
    c = make_client()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        _oubli(c)
    jeton = _jeton(caplog)
    r = _reinit(c, jeton)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert c.get(f"{API}/auth/me").status_code == 401  # pas de connexion automatique
    r2 = _reinit(c, jeton, "<mot-de-passe-test-u1>")
    assert r2.status_code == 400
    assert r2.json()["detail"] == "Lien invalide ou expiré"


def test_reinit_puis_connexion_avec_le_nouveau_mot_de_passe(make_client, caplog, db):
    c = make_client()
    with caplog.at_level(logging.WARNING, logger=LOGGER):
        _oubli(c)
    assert _reinit(c, _jeton(caplog)).status_code == 200
    ancien = c.post(f"{API}/auth/login", json={"email": DRH, "password": PW})
    nouveau = c.post(f"{API}/auth/login", json={"email": DRH, "password": NOUVEAU})
    assert ancien.status_code == 401 and nouveau.status_code == 200
    assert db.scalar(select(AuditEvent.id).where(AuditEvent.action == "reinit_mdp")) is not None


def test_reinit_jeton_expire(make_client, db, monkeypatch):
    monkeypatch.setattr(settings, "RESET_TOKEN_MINUTES", -1)
    r = _reinit(make_client(), _jeton_reset(db))
    assert r.status_code == 400


@pytest.mark.parametrize("kind", ["access", "refresh"])
def test_reinit_jeton_de_mauvais_type(make_client, db, kind):
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == DRH))
    jeton = make_token(u.id, kind, pwd=empreinte(u.password_hash))
    assert _reinit(make_client(), jeton).status_code == 400


def test_reinit_jeton_invalide_ou_vide(make_client):
    c = make_client()
    assert _reinit(c, "n-importe-quoi").status_code == 400
    assert _reinit(c, "").status_code == 400


def test_reinit_jeton_perime_apres_changement_de_mot_de_passe(make_client, db, admin_change_mdp):
    jeton = _jeton_reset(db)
    admin_change_mdp()
    assert _reinit(make_client(), jeton).status_code == 400


def test_reinit_mot_de_passe_trop_court(make_client, db):
    r = _reinit(make_client(), _jeton_reset(db), "court")
    assert r.status_code == 422
    assert r.json()["detail"] == "Mot de passe : 8 caractères minimum"
    # Le mot de passe n'a pas changé : le jeton reste utilisable.
    assert _reinit(make_client(), _jeton_reset(db)).status_code == 200
