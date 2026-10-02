from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_health():
    r = client.get("/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_ready_avec_base():
    r = client.get("/health/ready")
    assert r.status_code == 200


def test_docs_actives_hors_prod():
    assert client.get("/docs").status_code == 200
