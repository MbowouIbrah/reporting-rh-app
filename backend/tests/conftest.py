import os

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", "<cle-de-test>")
os.environ["COOKIE_SECURE"] = "false"

import bcrypt  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

import app.models  # noqa: E402,F401
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.auth import Utilisateur  # noqa: E402
from app.seed import run  # noqa: E402

PW = "<mot-de-passe-test>"

# Vrai bcrypt au coût minimal : chaque test recrée 9 comptes, soit 5 s de préparation au coût normal.
_gensalt = bcrypt.gensalt
bcrypt.gensalt = lambda rounds=4, prefix=b"2b": _gensalt(rounds, prefix)


def mot_de_passe_choisi(db, email: str) -> None:
    """Un compte créé par un admin naît provisoire : le rend utilisable dans un test."""
    u = db.scalar(select(Utilisateur).where(Utilisateur.email == email))
    u.doit_changer_mdp = False
    db.commit()


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as session:
        run(session, "admin@exemple.invalid", PW, PW, mdp_provisoire=False)
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
