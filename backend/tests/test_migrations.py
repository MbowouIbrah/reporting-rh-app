from alembic.config import Config
from sqlalchemy import create_engine, inspect

from alembic import command
from app.core.config import settings

TABLES = {"perimetre", "perimetre_regle", "utilisateur", "role_assignment", "audit_event"}


def test_montee_et_descente(tmp_path, monkeypatch):
    url = f"sqlite+pysqlite:///{tmp_path / 'm.db'}"
    monkeypatch.setattr(settings, "DATABASE_URL", url)
    cfg = Config("alembic.ini")
    command.upgrade(cfg, "head")
    assert TABLES <= set(inspect(create_engine(url)).get_table_names())
    command.downgrade(cfg, "0001")
    assert not TABLES & set(inspect(create_engine(url)).get_table_names())
    command.upgrade(cfg, "head")
