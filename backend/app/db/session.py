from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, sessionmaker
from sqlalchemy.pool import StaticPool

from app.core.config import settings


class Base(DeclarativeBase):
    pass


_opts: dict = {"pool_pre_ping": True}
if settings.db_url.startswith("postgresql"):
    _opts.update(pool_size=5, max_overflow=5)
else:  # tests : SQLite en mémoire partagée entre les threads
    _opts.update(connect_args={"check_same_thread": False}, poolclass=StaticPool)
engine = create_engine(settings.db_url, **_opts)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
