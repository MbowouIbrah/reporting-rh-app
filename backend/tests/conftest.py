import os

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "<cle-de-test>")
os.environ["COOKIE_SECURE"] = "false"

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import app.models  # noqa: E402,F401
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.seed import run  # noqa: E402

PW = "<mot-de-passe-test>"


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        run(session, "admin@exemple.invalid", PW, PW)
        yield session


@pytest.fixture()
def make_client(db):
    def _make(email: str | None = None) -> TestClient:
        c = TestClient(app)
        if email:
            r = c.post("/api/v1/auth/login", json={"email": email, "password": PW})
            assert r.status_code == 200, r.text
        return c

    return _make
