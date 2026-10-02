from sqlalchemy import create_engine

import app.models  # noqa: F401
from alembic import context
from app.core.config import settings
from app.db.session import Base

target_metadata = Base.metadata


def run_migrations_online() -> None:
    engine = create_engine(settings.db_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    context.configure(url=settings.db_url, target_metadata=target_metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    run_migrations_online()
