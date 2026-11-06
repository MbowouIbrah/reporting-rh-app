import os
import secrets

os.environ.setdefault("ENV", "test")
os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
os.environ.setdefault("SECRET_KEY", secrets.token_urlsafe(48))
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
from tests.identites import DOMAINE, courriel, mot_de_passe  # noqa: E402

PW = mot_de_passe()

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
        run(session, courriel("admin"), PW, PW, mdp_provisoire=False, demo_domaine=DOMAINE)
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


# Carte des tests (CARTE_TESTS=1) : note quels fichiers de app/ chaque fichier de test exécute,
# pour ne relancer ensuite que les tests touchés par un changement (tools/tests_cibles.py).
if os.environ.get("CARTE_TESTS"):
    import json
    from pathlib import Path

    import coverage

    _RACINE = Path(__file__).resolve().parents[1]
    _cov = coverage.Coverage(data_file=None, source=[str(_RACINE / "app")], concurrency=["thread"])

    def pytest_sessionstart(session):
        _cov.start()

    def pytest_runtest_setup(item):
        _cov.switch_context(item.nodeid.split("::")[0])

    def pytest_sessionfinish(session, exitstatus):
        _cov.stop()
        donnees = _cov.get_data()
        carte: dict[str, list[str]] = {}
        for f in donnees.measured_files():
            ctx = set()
            for c in donnees.contexts_by_lineno(f).values():
                ctx.update(c)
            ctx.discard("")
            rel = Path(f).resolve().relative_to(_RACINE).as_posix()
            carte[rel] = sorted(ctx)
        (_RACINE / ".carte-tests.json").write_text(json.dumps(carte, indent=0), encoding="utf-8")
