from datetime import UTC, datetime, timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from app import comptes
from app.main import app
from app.models.auth import AuditEvent, LienConnexion, Utilisateur
from app.security import liens
from tests.identites import courriel

API = "/api/v1"
DRH = courriel("drh")


def _user(db, email=DRH):
    return db.scalar(select(Utilisateur).where(Utilisateur.email == email))


def _jeton(db, email=DRH, jours=14):
    j = liens.creer(db, _user(db, email), jours)
    db.commit()
    return j


def _entrer(jeton):
    c = TestClient(app)
    return c, c.post(f"{API}/auth/lien", json={"jeton": jeton})


def test_lien_ouvre_la_session_et_trace(db):
    jeton = _jeton(db)
    c, r = _entrer(jeton)
    assert r.status_code == 200, r.text
    assert r.json()["email"] == DRH
    cookies = {s.split("=", 1)[0]: s for s in r.headers.get_list("set-cookie")}
    assert "HttpOnly" in cookies["access_token"] and "Max-Age" not in cookies["access_token"]
    assert c.get(f"{API}/auth/me").json()["email"] == DRH
    db.expire_all()
    lien = db.scalar(select(LienConnexion))
    assert lien.nb_utilisations == 1 and lien.derniere_utilisation is not None
    assert lien.empreinte != jeton and jeton not in lien.empreinte
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "login_lien")).utilisateur_id == _user(db).id


def test_lien_reutilisable_jusqua_expiration(db):
    jeton = _jeton(db)
    assert _entrer(jeton)[1].status_code == 200
    assert _entrer(jeton)[1].status_code == 200


def test_lien_refuse(db):
    jeton = _jeton(db)
    for mauvais in ("", "x", jeton + "x", "a" * 500):
        assert _entrer(mauvais)[1].status_code == 401
    assert db.scalar(select(AuditEvent).where(AuditEvent.action == "login_lien_echec"))


def test_lien_expire(db):
    jeton = _jeton(db)
    lien = db.scalar(select(LienConnexion))
    lien.expire_le = datetime.now(UTC) - timedelta(seconds=1)
    db.commit()
    r = _entrer(jeton)[1]
    assert r.status_code == 401 and r.json()["detail"] == "Lien invalide ou expiré"


def test_lien_revoque_et_compte_inactif(db):
    j1, j2 = _jeton(db), _jeton(db, courriel("dop"))
    assert liens.revoquer(db, _user(db)) == 1
    db.commit()
    assert _entrer(j1)[1].status_code == 401
    _user(db, courriel("dop")).actif = False
    db.commit()
    assert _entrer(j2)[1].status_code == 401


def test_console_cree_et_revoque(db, capsys):
    assert comptes.main(["lien", DRH, "--jours", "3", "--base", "https://demo.example/"], db=db) == 0
    sortie = capsys.readouterr().out.strip()
    assert sortie.startswith("https://demo.example/connexion-rapide#jeton=")
    jeton = sortie.split("#jeton=", 1)[1]
    assert _entrer(jeton)[1].status_code == 200
    assert comptes.main(["lien", DRH, "--jours", "0"], db=db) == 1
    assert comptes.main(["revoquer-liens"], db=db) == 0
    assert "1 lien(s)" in capsys.readouterr().out
    assert _entrer(jeton)[1].status_code == 401
