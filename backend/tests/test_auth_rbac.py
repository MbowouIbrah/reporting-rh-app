import pytest
from sqlalchemy import Column, Integer, MetaData, String, Table, select
from sqlalchemy import insert as sa_insert

from app.models.auth import AuditEvent, Perimetre, Utilisateur
from app.repos.scope import apply_scope, scope_for
from app.security.deps import to_principal
from tests.conftest import PW
from tests.identites import courriel

API = "/api/v1"
ADMIN = courriel("admin")
DRH = courriel("drh")
EQUIP = courriel("dps.equipment")
VN = courriel("dir.commercial.vn")
NEW_USER = {
    "email": courriel("x"),
    "nom": "X",
    "password": PW,
    "permissions": ["nominatif", "marge"],
    "portee": {"tout": True},
}


def test_login_ok_et_cookies_httponly(make_client):
    c = make_client()
    r = c.post(f"{API}/auth/login", json={"email": ADMIN, "password": PW})
    assert r.status_code == 200
    cookies = r.headers.get_list("set-cookie")
    assert len(cookies) == 2 and all("HttpOnly" in s for s in cookies)
    assert c.get(f"{API}/auth/me").json()["email"] == ADMIN


@pytest.mark.parametrize(
    "email,pw", [(ADMIN, "faux"), (courriel("inconnu"), PW), ("", "")]
)
def test_login_refuse(make_client, email, pw):
    r = make_client().post(f"{API}/auth/login", json={"email": email, "password": pw})
    assert r.status_code == 401


def test_utilisateur_inactif_refuse_et_session_coupee(make_client):
    admin, drh = make_client(ADMIN), make_client(DRH)
    uid = drh.get(f"{API}/auth/me").json()["id"]
    assert admin.put(f"{API}/users/{uid}", json={"actif": False}).status_code == 200
    assert drh.get(f"{API}/auth/me").status_code == 401
    r = make_client().post(f"{API}/auth/login", json={"email": DRH, "password": PW})
    assert r.status_code == 401


def test_refresh_et_logout(make_client):
    c = make_client(ADMIN)
    assert c.post(f"{API}/auth/refresh").status_code == 200
    c.post(f"{API}/auth/logout")
    assert c.get(f"{API}/auth/me").status_code == 401
    assert c.post(f"{API}/auth/refresh").status_code == 401


def test_access_token_ne_sert_pas_de_refresh(make_client):
    c = make_client(ADMIN)
    c.cookies.set("refresh_token", c.cookies.get("access_token"), path=f"{API}/auth")
    assert c.post(f"{API}/auth/refresh").status_code == 401


# endpoint, méthode, corps ; réservés à la gestion des comptes
WRITES = [
    ("post", "/users", NEW_USER),
    ("put", "/users/1", {"nom": "Z"}),
    ("delete", "/users/1", None),
    ("post", "/perimetres", {"code": "n", "libelle": "N"}),
    ("put", "/perimetres/1", {"code": "n", "libelle": "N"}),
    ("delete", "/perimetres/1", None),
]
ADMIN_ONLY_READS = ["/users", "/audit"]


@pytest.mark.parametrize("who", [DRH, EQUIP, VN])
@pytest.mark.parametrize("method,path,body", WRITES)
def test_lecteurs_403_sur_toute_ecriture(make_client, who, method, path, body):
    r = getattr(make_client(who), method)(f"{API}{path}", **({"json": body} if body else {}))
    assert r.status_code == 403


@pytest.mark.parametrize("who", [DRH, EQUIP, VN])
@pytest.mark.parametrize("path", ADMIN_ONLY_READS)
def test_lecteurs_403_sur_lectures_admin(make_client, who, path):
    assert make_client(who).get(f"{API}{path}").status_code == 403


@pytest.mark.parametrize("method,path,body", WRITES + [("get", p, None) for p in ADMIN_ONLY_READS])
def test_anonyme_401(make_client, method, path, body):
    r = getattr(make_client(), method)(f"{API}{path}", **({"json": body} if body else {}))
    assert r.status_code == 401


def test_lecteur_perimetre_ne_voit_que_le_sien(make_client):
    equip = make_client(EQUIP)
    liste = equip.get(f"{API}/perimetres").json()
    assert [p["code"] for p in liste] == ["dps"]
    ids = {p["code"]: p["id"] for p in make_client(ADMIN).get(f"{API}/perimetres").json()}
    assert equip.get(f"{API}/perimetres/{ids['dps']}").status_code == 200
    assert equip.get(f"{API}/perimetres/{ids['commerce_vn']}").status_code == 403
    assert make_client(VN).get(f"{API}/perimetres/{ids['dps']}").status_code == 403
    assert len(make_client(DRH).get(f"{API}/perimetres").json()) == 6


def test_filtre_de_perimetre_couche_depot(db):
    meta = MetaData()
    t = Table("ligne", meta, Column("id", Integer, primary_key=True), Column("service", String))
    meta.create_all(db.get_bind())
    db.execute(
        sa_insert(t),
        [{"service": s} for s in ("SAV PL", "Pneumatique", "Commerce Pièces", "Commerce VN", "Administration")],
    )

    def vus(email):
        u = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
        scope = scope_for(db, to_principal(u))
        stmt = apply_scope(select(t.c.service), scope, service=t.c.service)
        return {r[0] for r in db.execute(stmt)}

    assert vus(EQUIP) == {"SAV PL", "Commerce Pièces"}  # DPS : plus Pneumatique
    assert vus(VN) == {"Commerce VN"}
    assert len(vus(DRH)) == 5 and len(vus(ADMIN)) == 5
    # périmètre sans règle = aucune donnée
    p = db.scalar(select(Perimetre).where(Perimetre.code == "commerce_vn"))
    p.regles.clear()
    db.commit()
    assert vus(VN) == set()


def test_ecritures_auditees_avant_apres(make_client, db):
    admin = make_client(ADMIN)
    r = admin.post(f"{API}/users", json=NEW_USER)
    assert r.status_code == 201
    uid = r.json()["id"]
    admin.put(f"{API}/users/{uid}", json={"nom": "Y"})
    admin.post(f"{API}/perimetres", json={"code": "n", "libelle": "N"})
    admin.delete(f"{API}/users/{uid}")
    evts = db.scalars(select(AuditEvent).where(AuditEvent.action != "login")).all()
    assert [(e.action, e.entite) for e in evts] == [
        ("create", "utilisateur"),
        ("update", "utilisateur"),
        ("create", "perimetre"),
        ("delete", "utilisateur"),
    ]
    upd = evts[1]
    assert upd.avant["nom"] == "X" and upd.apres["nom"] == "Y"
    assert "password" not in str(evts[0].apres) and "hash" not in str(evts[0].apres)
    assert all(e.utilisateur_id for e in evts)
    assert len(admin.get(f"{API}/audit").json()) >= 5


def test_ecriture_refusee_non_auditee(make_client, db):
    make_client(DRH).post(f"{API}/users", json=NEW_USER)
    assert db.scalars(select(AuditEvent).where(AuditEvent.action == "create")).all() == []


def test_validations(make_client):
    admin = make_client(ADMIN)
    assert admin.post(f"{API}/users", json={**NEW_USER, "password": "court"}).status_code == 422
    bad = {**NEW_USER, "portee": {"tout": False, "sites": ["Lune"]}}
    assert admin.post(f"{API}/users", json=bad).status_code == 422
    assert admin.post(f"{API}/users", json={**NEW_USER, "email": ADMIN}).status_code == 409
    assert admin.delete(f"{API}/users/1").status_code == 409  # auto-suppression
    assert admin.delete(f"{API}/users/999").status_code == 404


def test_me_fonction_et_actions(make_client):
    me = make_client(EQUIP).get(f"{API}/auth/me").json()
    assert me["fonction"] == "Lecteur de périmètre" and "roles" not in me
    assert me["permissions"] == ["perimetre:read", "report:read"]
    admin = make_client(ADMIN).get(f"{API}/auth/me").json()
    assert {"users:write", "import:write", "marge:read"} <= set(admin["permissions"])
