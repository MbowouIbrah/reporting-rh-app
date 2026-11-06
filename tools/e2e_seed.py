"""Base de recette Playwright : SQLite fichier, comptes de démo, 2 mois de données + CA.

Usage (depuis backend/) : DATABASE_URL=sqlite:///e2e.db python ../tools/e2e_seed.py
Mot de passe de tous les comptes : variable E2E_PASSWORD (obligatoire).
"""

import os
import secrets
import sys
from decimal import Decimal
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent / "backend"
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("ENV", "test")
os.environ.setdefault("SECRET_KEY", secrets.token_urlsafe(48))
os.environ["COOKIE_SECURE"] = "false"

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

import app.models  # noqa: E402,F401
from app.db.session import Base, SessionLocal, engine  # noqa: E402
from app.main import app  # noqa: E402
from app.models.donnees import Periode  # noqa: E402
from app.models.pilotage import ValeurSaisie  # noqa: E402
from app.seed import run  # noqa: E402
from tests.identites import DOMAINE, courriel  # noqa: E402
from tests.test_import_regles import xlsx  # noqa: E402
from tests.test_rapports_api import API, XLSX, donnees  # noqa: E402

PW = os.environ.get("E2E_PASSWORD")
if not PW:
    sys.exit("e2e_seed : variable E2E_PASSWORD requise (mot de passe des comptes de test)")


def main() -> None:
    if not engine.url.drivername.startswith("sqlite"):
        sys.exit("e2e_seed : base SQLite uniquement")
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as db:
        run(db, courriel("admin"), PW, PW, mdp_provisoire=False, demo_domaine=DOMAINE)
        c = TestClient(app)
        assert c.post(f"{API}/auth/login", json={"email": courriel("admin"), "password": PW}).status_code == 200
        lot = c.post(f"{API}/imports", files={"fichier": ("d.xlsx", xlsx(donnees()), XLSX)}).json()
        assert lot["statut"] == "pret", lot
        assert c.post(f"{API}/imports/{lot['id']}/valider").status_code == 200
        pid = db.scalar(select(Periode.id).where(Periode.annee == 2026, Periode.mois == 1))
        db.add(ValeurSaisie(periode_id=pid, indicateur="ca", valeur=Decimal("10000")))
        db.commit()
    print("e2e seed ok")


if __name__ == "__main__":
    main()
