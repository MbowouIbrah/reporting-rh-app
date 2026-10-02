from decimal import Decimal

from sqlalchemy import select

from app.models.auth import AuditEvent
from app.models.donnees import Periode
from app.models.pilotage import CaPeriode

API = "/api/v1"
ADMIN, DRH = "admin@exemple.invalid", "drh@exemple.invalid"


def periode(db, statut="ouverte"):
    per = Periode(annee=2026, mois=1, statut=statut)
    db.add(per)
    db.commit()
    return per.id


def put(c, pid, valeur):
    return c.put(f"{API}/periodes/{pid}/ca", json={"valeur": valeur})


def test_ca_saisie_audit_et_decimal_exact(db, make_client):
    pid = periode(db)
    c = make_client(ADMIN)
    r = put(c, pid, "1234567.891")
    assert r.status_code == 200 and r.json()["ca"] == "1234567.891"
    db.expire_all()
    assert db.get(CaPeriode, pid).valeur == Decimal("1234567.891")
    assert put(c, pid, "10,5").json()["ca"] == "10.500"
    ev = db.scalars(select(AuditEvent).where(AuditEvent.action == "saisie_ca")).all()
    assert len(ev) == 2 and ev[0].avant["ca"] is None and ev[1].avant["ca"] == "1234567.891"
    assert c.get(f"{API}/periodes").json()[0]["ca"] == "10.500"


def test_ca_null_supprime(db, make_client):
    pid = periode(db)
    c = make_client(ADMIN)
    put(c, pid, "5")
    assert put(c, pid, None).json()["ca"] is None
    db.expire_all()
    assert db.get(CaPeriode, pid) is None


def test_ca_periode_close_409(db, make_client):
    pid = periode(db, "close")
    assert put(make_client(ADMIN), pid, "5").status_code == 409


def test_ca_lecteur_403_et_invalide_422(db, make_client):
    pid = periode(db)
    assert put(make_client(DRH), pid, "5").status_code == 403
    assert put(make_client(ADMIN), pid, "abc").status_code == 422
    assert put(make_client(ADMIN), pid, "-1").status_code == 422
    assert put(make_client(ADMIN), 999, "5").status_code == 404
