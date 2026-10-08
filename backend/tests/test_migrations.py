from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.core.config import settings

TABLES = {"perimetre", "perimetre_regle", "utilisateur", "role_assignment", "audit_event"}
TABLES3 = {"service", "periode", "salarie", "situation_mensuelle", "montant", "lot_import",
           "staging_ligne", "import_anomalie", "rubrique_regle", "budget"}


def test_montee_et_descente(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'm.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    insp = inspect(create_engine(url))
    assert "statut" not in {c["name"] for c in insp.get_columns("periode")}
    assert any("mois" in c["sqltext"] for c in insp.get_check_constraints("periode"))
    assert TABLES <= set(inspect(create_engine(url)).get_table_names())
    assert TABLES3 <= set(inspect(create_engine(url)).get_table_names())
    command.downgrade(cfg, "0001")
    assert not TABLES & set(inspect(create_engine(url)).get_table_names())
    command.upgrade(cfg, "head")
