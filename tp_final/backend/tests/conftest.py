from pathlib import Path

import pytest
from alembic import command
from alembic.config import Config as AlembicConfig
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from tests.helpers import TEST_DATABASE_URL

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="session")
def engine():
    engine = create_engine(TEST_DATABASE_URL, hide_parameters=True)
    with engine.begin() as conn:
        conn.execute(text("DROP SCHEMA public CASCADE"))
        conn.execute(text("CREATE SCHEMA public"))
    alembic_cfg = AlembicConfig(str(BACKEND_DIR / "alembic.ini"))
    alembic_cfg.set_main_option("sqlalchemy.url", TEST_DATABASE_URL)
    command.upgrade(alembic_cfg, "head")
    yield engine
    engine.dispose()


@pytest.fixture
def session_factory(engine):
    # Real commits are needed (concurrency tests), so isolate tests by truncating.
    with engine.begin() as conn:
        conn.execute(text("TRUNCATE recipient_grants, share_payloads, shares"))
    return sessionmaker(engine, expire_on_commit=False)
