# Chismoso MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chismoso MVP: a self-hosted one-time secret handoff app with client-side AES-256-GCM, Keycloak SSO, one-time recipient grants, and a metadata-only admin list. It runs locally at `http://app.localhost:3000`.

**Architecture:** A FastAPI (sync SQLAlchemy 2 + Psycopg 3) backend stores only ciphertext and authorization metadata in PostgreSQL. A React + Vite frontend encrypts and decrypts with WebCrypto and authenticates with `oidc-client-ts` popups against the pre-existing Keycloak. A Caddy reverse proxy makes frontend and API same-origin, with `/api/*` going to FastAPI and everything else to Vite (dev) or static files (prod).

**Tech Stack:** CPython 3.14, uv, FastAPI, Pydantic 2, pydantic-settings, SQLAlchemy 2 (sync), Psycopg 3, Alembic, PyJWT[crypto], pytest; React 19, TypeScript, Vite 8, react-router, oidc-client-ts 3, Vitest, Testing Library, Playwright; PostgreSQL 18, Caddy 2, Docker Compose.

**Spec:** `tp_final/docs/superpowers/specs/2026-10-08-chismoso-mvp-design.md` (design + gap decisions), which builds on the normative base spec `tp_final/chismoso_spec_v1_1_reconciled.md`. Executors read **both**. The base spec wins on any rule it states.

## Global Constraints

- All paths in this plan are relative to `tp_final/` unless they start with `backend/` or `frontend/` (also inside `tp_final/`). Run backend commands from `tp_final/backend`, frontend commands from `tp_final/frontend`, compose commands from `tp_final/`.
- Code, comments, docs, API names, error codes: **English**. Every human-facing frontend string: **Spanish** (Rioplatense voseo, e.g. "Iniciá sesión").
- Server **never** receives plaintext or CEK. Never log, persist, or echo raw share tokens, CEKs, plaintext, ciphertext request bodies, Authorization headers, or full share URLs.
- No DB status columns, no users table, no persisted `shared_token`, no `GET` that consumes, no auto-consume after login, no automatic retry of consume.
- Do not implement anything listed as post-MVP in base spec §24 (no revoke endpoint, no cleanup worker, no user share list, no email).
- Backend: Python `>=3.14,<3.15`, synchronous endpoints (`def`), SQLAlchemy 2 typed ORM, Pydantic 2 models for API I/O.
- Frontend: no externally loaded runtime JS, no CDN, no analytics. No `localStorage` for anything secret. OIDC user/state stores are memory-only.
- Dev URL is exactly `http://app.localhost:3000`. Keycloak issuer is exactly `http://idp.localhost:8080/realms/chismoso`. JWT `iss` is always validated against `OIDC_ISSUER`.
- Test DB: `postgresql+psycopg://chismoso:chismoso@127.0.0.1:5433/chismoso_test` (Compose `db` service published on host port 5433).
- Dev Keycloak test users: password = lowercase first name (`aperez`/`alicia`, `bgonzalez`/`boberto`, `csaul`/`carlitos`, `dlopez`/`daniel`, `efuseneco`/`elena`, `flapinto`/`franco`; only `flapinto` is admin). These appear **only** in e2e test code.
- SQLAlchemy `func.make_interval` does not accept named args. If you need it, call it positionally: `func.make_interval(0, 0, 0, 0, 0, minutes)`. This plan avoids it by adding a Python `timedelta` to the DB `now()` value.
- Library APIs: versions installed are newer than some reference material. Where the plan names a library symbol (e.g. `jwt.PyJWKClientConnectionError`, `oidc-client-ts` `InMemoryWebStorage`, `react-router` `BrowserRouter`), check it exists in the installed version (`uv run python -c "import jwt; print(jwt.PyJWKClientConnectionError)"`, or read `node_modules/<pkg>/dist/*.d.ts`). If it was renamed, use the equivalent and note it in the commit message.
- Git: work on branch `tp-final`. **Stage only the files your task lists** (`git add <paths>`; never `git add -A` / `git add .`). Every commit message ends with a blank line followed by `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Each task header names a **Model** (sonnet or opus) for the subagent that implements it.

## Review Focus

1. **Session expires while the sender is filling the create form.** Keycloak access tokens last about 5 minutes and there is no silent renew. A person who types a secret and then submits must get a re-login prompt with the typed plaintext still in the form, not a lost form or a raw error. *Pinned in Task 13.*
2. **Login popup blocked or closed by the user.** The page must show a Spanish explanation, stay usable, and never consume. *Pinned in Tasks 12 and 14.*
3. **Multi-byte secrets near the 64 KiB limit.** The limit is UTF-8 **bytes**, not characters (`'ñ'.repeat(32769)` is too large). A secret of exactly the max size must be accepted end-to-end by the backend's ciphertext ceiling. *Pinned in Tasks 5, 13 and 16.*
4. **Inputs that would overflow or break PostgreSQL types.** `crypto_version > 2^31-1`, a label containing NUL (`\x00`), or an absurd admin `page` number must give 422, never 500. *Pinned in Tasks 5 and 7.*
5. **The consume response is lost (network error or 5xx).** The UI must say the secret may already have been consumed. It must offer only an explicit, user-clicked retry and never retry by itself. *Pinned in Task 14.*

---

## File Structure

```
tp_final/
  .gitignore  .env.example  .dockerignore
  compose.yaml              # dev stack (db in Task 1; full in Task 8)
  compose.prod.yaml         # prod-like smoke stack (Task 17)
  README.md                 # Task 18
  infra/postgres/init/01-create-test-db.sh
  infra/caddy/Caddyfile.dev   infra/caddy/Caddyfile.prod
  backend/
    pyproject.toml uv.lock .python-version alembic.ini Dockerfile .dockerignore
    app/
      __init__.py
      config.py       # Settings (env)
      db.py           # session factory
      models.py       # Share, SharePayload, RecipientGrant
      encoding.py     # unpadded base64url
      usernames.py    # canonicalize_username
      tokens.py       # generate_access_token, hash_access_token
      timeutil.py     # to_utc
      errors.py       # AppError, constructors, envelope handlers, SECURITY_HEADERS
      middleware.py   # access log + security headers
      deps.py         # get_settings, get_session
      auth.py         # TokenVerifier, Principal, current_principal, require_admin
      shares.py       # POST /api/v1/shares
      consume.py      # POST /api/v1/access/consume
      admin.py        # GET /api/v1/admin/shares
      main.py         # create_app
    migrations/env.py migrations/script.py.mako migrations/versions/0001_initial.py
    scripts/gen_crypto_vectors.py
    tests/ __init__.py conftest.py helpers.py test_*.py
  frontend/
    (create-vite react-ts scaffold) vite.config.ts playwright.config.ts
    src/
      main.tsx App.tsx index.css vite-env.d.ts config.ts secureContext.ts link.ts api.ts
      crypto/base64url.ts crypto/v1.ts crypto/__fixtures__/v1-vectors.json
      i18n/messages.ts i18n/format.ts
      auth/oidc.ts auth/context.ts auth/AuthProvider.tsx
      components/Layout.tsx components/LoginPrompt.tsx components/RequireLogin.tsx components/CopyButton.tsx components/InsecureContext.tsx
      pages/AuthCallback.tsx pages/NotFound.tsx
      pages/create/CreatePage.tsx pages/create/recipients.ts pages/create/expiry.ts
      pages/open/OpenPage.tsx
      pages/admin/AdminPage.tsx pages/admin/status.ts
      test/setup.ts test/auth.tsx
    e2e/support.ts e2e/flows.spec.ts e2e/smoke.spec.ts
    Dockerfile                                  # prod build → Caddy static (Task 17)
```

---

## Milestone 1 — Backend

### Task 1: Backend project, settings, database schema, test DB

**Model:** sonnet

**Files:**
- Create: `.gitignore`, `.env.example`, `compose.yaml`, `infra/postgres/init/01-create-test-db.sh`
- Create: `backend/pyproject.toml` (then `uv add` updates it, creating `uv.lock`, `.python-version`)
- Create: `backend/app/__init__.py`, `backend/app/config.py`, `backend/app/db.py`, `backend/app/models.py`
- Create: `backend/alembic.ini`, `backend/migrations/env.py`, `backend/migrations/script.py.mako`, `backend/migrations/versions/0001_initial.py`
- Test: `backend/tests/__init__.py`, `backend/tests/helpers.py`, `backend/tests/conftest.py`, `backend/tests/test_schema.py`

**Interfaces:**
- Produces: `app.config.Settings` (fields below, property `jwks_url`); `app.db.make_session_factory(database_url: str) -> sessionmaker[Session]`; ORM classes `Share`, `SharePayload`, `RecipientGrant` in `app.models`; pytest fixtures `engine` (session scope, migrated test DB) and `session_factory` (truncates all tables, returns `sessionmaker`); `tests.helpers.TEST_DATABASE_URL`.

- [ ] **Step 1: Repo-level files**

`.gitignore`:
```gitignore
.env
node_modules/
dist/
.venv/
__pycache__/
*.pyc
.pytest_cache/
test-results/
playwright-report/
```

`.env.example`:
```dotenv
# Copy to .env (gitignored). One schema for dev and production; values below are local-dev values.

# --- Database. DATABASE_URL uses Compose service names (container view).
#     Host-run tests use TEST_DATABASE_URL (default in backend/tests/helpers.py).
POSTGRES_USER=chismoso
POSTGRES_PASSWORD=chismoso
POSTGRES_DB=chismoso
DATABASE_URL=postgresql+psycopg://chismoso:chismoso@db:5432/chismoso

# --- OIDC / Keycloak
OIDC_ISSUER=http://idp.localhost:8080/realms/chismoso
OIDC_ORIGIN=http://idp.localhost:8080
OIDC_CLIENT_ID=chismoso
OIDC_EXPECTED_AUDIENCE=chismoso-api
OIDC_ADMIN_CLIENT_ID=chismoso
OIDC_ADMIN_ROLE=chismoso-admin
# Optional key-retrieval address. Empty => derived from OIDC_ISSUER (production).
# Local dev: Keycloak reached over its Docker network; `iss` is still validated against OIDC_ISSUER.
OIDC_JWKS_URL=http://keycloak:8080/realms/chismoso/protocol/openid-connect/certs
# Docker network of the separately operated local Keycloak stack (local compose files only).
IDP_DOCKER_NETWORK=chismoso-idp_default

# --- Limits (backend authoritative; MAX_PLAINTEXT_BYTES is also baked into the frontend build)
MIN_EXPIRES_IN_MINUTES=10
MAX_EXPIRES_IN_MINUTES=43200
MAX_RECIPIENTS_PER_SHARE=100
MAX_LABEL_LENGTH=256
MAX_PLAINTEXT_BYTES=65536
MAX_CIPHERTEXT_BYTES=65552
MAX_NONCE_BYTES=256
MAX_ADMIN_PAGE_SIZE=100
```

`infra/postgres/init/01-create-test-db.sh`:
```sh
#!/bin/sh
# Creates the database used by host-run backend tests (see backend/tests/helpers.py).
set -eu
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "CREATE DATABASE chismoso_test OWNER \"$POSTGRES_USER\";"
```

`compose.yaml` (db only for now; Task 8 replaces this file with the full stack):
```yaml
name: chismoso

services:
  db:
    image: postgres:18-alpine
    env_file: .env
    volumes:
      - db-data:/var/lib/postgresql
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30

volumes:
  db-data:
```

Run: `cp .env.example .env && chmod +x infra/postgres/init/01-create-test-db.sh && docker compose up -d db`
Then: `docker compose exec db psql -U chismoso -d chismoso_test -c 'select 1'`
Expected: one row `1`.

- [ ] **Step 2: Python project**

`backend/pyproject.toml`:
```toml
[project]
name = "chismoso-backend"
version = "0.1.0"
description = "Chismoso one-time secret handoff API"
requires-python = ">=3.14,<3.15"
dependencies = []

[tool.pytest.ini_options]
testpaths = ["tests"]
pythonpath = ["."]
```

Run (from `backend/`):
```bash
uv python pin 3.14
uv add fastapi pydantic-settings "sqlalchemy>=2.0" "psycopg[binary]>=3.2" alembic "pyjwt[crypto]>=2.10" "uvicorn>=0.30"
uv add --dev pytest httpx
```
Expected: `uv.lock` and `.python-version` created; `uv run python -V` prints `Python 3.14.x`.

- [ ] **Step 3: Settings, DB, models**

`backend/app/__init__.py`: empty file.

`backend/app/config.py`:
```python
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings read from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(extra="ignore")

    database_url: str
    oidc_issuer: str
    oidc_expected_audience: str = "chismoso-api"
    oidc_admin_client_id: str = "chismoso"
    oidc_admin_role: str = "chismoso-admin"
    oidc_jwks_url: str | None = None

    min_expires_in_minutes: int = 10
    max_expires_in_minutes: int = 43200
    max_recipients_per_share: int = 100
    max_label_length: int = 256
    max_ciphertext_bytes: int = 65552
    max_nonce_bytes: int = 256
    max_admin_page_size: int = 100

    @property
    def jwks_url(self) -> str:
        """Key-retrieval URL; only the transport address may differ from the issuer."""
        if self.oidc_jwks_url:
            return self.oidc_jwks_url
        return f"{self.oidc_issuer.rstrip('/')}/protocol/openid-connect/certs"
```

`backend/app/db.py`:
```python
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker


def make_session_factory(database_url: str) -> sessionmaker[Session]:
    # hide_parameters keeps bound values (ciphertext, token hashes) out of logs and DB exception messages.
    engine = create_engine(database_url, pool_pre_ping=True, hide_parameters=True)
    return sessionmaker(engine, expire_on_commit=False)
```

`backend/app/models.py`:
```python
import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    creator_identity: Mapped[str] = mapped_column(Text, nullable=False)
    # Non-secret metadata; length is enforced in business logic, not by the column type.
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


Index("ix_shares_created_at_id", Share.created_at.desc(), Share.id.desc())


class SharePayload(Base):
    __tablename__ = "share_payloads"
    __table_args__ = (
        CheckConstraint("crypto_version > 0", name="ck_share_payloads_crypto_version_positive"),
    )

    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("shares.id", ondelete="RESTRICT"), primary_key=True
    )
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # Opaque to the server: stored and returned, never interpreted.
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)


class RecipientGrant(Base):
    __tablename__ = "recipient_grants"
    __table_args__ = (
        UniqueConstraint("share_id", "recipient_identity", name="uq_recipient_grants_share_recipient"),
        # Not unique: shared-token mode stores the same hash on several grants.
        Index("ix_recipient_grants_token_recipient", "access_token_hash", "recipient_identity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("shares.id", ondelete="RESTRICT"), nullable=False
    )
    recipient_identity: Mapped[str] = mapped_column(Text, nullable=False)
    access_token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
```

- [ ] **Step 4: Alembic**

`backend/alembic.ini`:
```ini
[alembic]
script_location = %(here)s/migrations
prepend_sys_path = .
# The database URL comes from DATABASE_URL (see migrations/env.py); tests set sqlalchemy.url.

[loggers]
keys = root,sqlalchemy,alembic

[handlers]
keys = console

[formatters]
keys = generic

[logger_root]
level = WARNING
handlers = console

[logger_sqlalchemy]
level = WARNING
handlers =
qualname = sqlalchemy.engine

[logger_alembic]
level = INFO
handlers =
qualname = alembic

[handler_console]
class = StreamHandler
args = (sys.stderr,)
level = NOTSET
formatter = generic

[formatter_generic]
format = %(levelname)-5.5s [%(name)s] %(message)s
```

`backend/migrations/env.py`:
```python
import os
from logging.config import fileConfig

from alembic import context
from sqlalchemy import create_engine

from app.models import Base

config = context.config
if config.config_file_name is not None:
    # Keep application loggers alive (pytest's caplog relies on them).
    fileConfig(config.config_file_name, disable_existing_loggers=False)

target_metadata = Base.metadata


def _database_url() -> str:
    return config.get_main_option("sqlalchemy.url") or os.environ["DATABASE_URL"]


def run_migrations_online() -> None:
    engine = create_engine(_database_url())
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=target_metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


if context.is_offline_mode():
    raise SystemExit("Offline migrations are not supported.")
run_migrations_online()
```

`backend/migrations/script.py.mako`:
```mako
"""${message}

Revision ID: ${up_revision}
Revises: ${down_revision | comma,n}
Create Date: ${create_date}
"""
import sqlalchemy as sa
from alembic import op
${imports if imports else ""}

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    ${downgrades if downgrades else "pass"}
```

`backend/migrations/versions/0001_initial.py`:
```python
"""Initial schema: shares, share_payloads, recipient_grants.

Revision ID: 0001
Revises:
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("creator_identity", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload_deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_shares_created_at_id", "shares", [sa.text("created_at DESC"), sa.text("id DESC")]
    )
    op.create_table(
        "share_payloads",
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="RESTRICT", name="fk_share_payloads_share_id"),
            primary_key=True,
        ),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("crypto_version", sa.Integer(), nullable=False),
        sa.CheckConstraint("crypto_version > 0", name="ck_share_payloads_crypto_version_positive"),
    )
    op.create_table(
        "recipient_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="RESTRICT", name="fk_recipient_grants_share_id"),
            nullable=False,
        ),
        sa.Column("recipient_identity", sa.Text(), nullable=False),
        sa.Column("access_token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "share_id", "recipient_identity", name="uq_recipient_grants_share_recipient"
        ),
    )
    op.create_index(
        "ix_recipient_grants_token_recipient",
        "recipient_grants",
        ["access_token_hash", "recipient_identity"],
    )


def downgrade() -> None:
    op.drop_table("recipient_grants")
    op.drop_table("share_payloads")
    op.drop_index("ix_shares_created_at_id", table_name="shares")
    op.drop_table("shares")
```

- [ ] **Step 5: Test fixtures and failing schema tests**

`backend/tests/__init__.py`: empty file.

`backend/tests/helpers.py`:
```python
import os

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://chismoso:chismoso@127.0.0.1:5433/chismoso_test"
)
```

`backend/tests/conftest.py`:
```python
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
```

`backend/tests/test_schema.py`:
```python
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models import Share, SharePayload


def test_tables_exist(engine):
    assert {"shares", "share_payloads", "recipient_grants"} <= set(inspect(engine).get_table_names())


def test_no_status_columns(engine):
    insp = inspect(engine)
    assert {c["name"] for c in insp.get_columns("shares")} == {
        "id", "creator_identity", "label", "created_at", "expires_at", "revoked_at", "payload_deleted_at",
    }
    assert {c["name"] for c in insp.get_columns("recipient_grants")} == {
        "id", "share_id", "recipient_identity", "access_token_hash", "consumed_at",
    }
    assert {c["name"] for c in insp.get_columns("share_payloads")} == {
        "share_id", "ciphertext", "nonce", "crypto_version",
    }


def test_access_token_hash_is_not_unique(engine):
    insp = inspect(engine)
    uniques = [u["column_names"] for u in insp.get_unique_constraints("recipient_grants")]
    assert uniques == [["share_id", "recipient_identity"]]
    indexes = {i["name"]: i for i in insp.get_indexes("recipient_grants")}
    token_index = indexes["ix_recipient_grants_token_recipient"]
    assert token_index["column_names"] == ["access_token_hash", "recipient_identity"]
    assert not token_index["unique"]


def test_label_is_unbounded_text(engine):
    columns = {c["name"]: c for c in inspect(engine).get_columns("shares")}
    assert str(columns["label"]["type"]) == "TEXT"


@pytest.mark.parametrize("table", ["share_payloads", "recipient_grants"])
def test_foreign_keys_are_restrictive(engine, table):
    (fk,) = inspect(engine).get_foreign_keys(table)
    assert fk["referred_table"] == "shares"
    assert fk["options"].get("ondelete") == "RESTRICT"


def test_crypto_version_must_be_positive(session_factory):
    now = datetime.now(UTC)
    with session_factory() as session:
        share = Share(id=uuid.uuid4(), creator_identity="aperez", created_at=now, expires_at=now)
        session.add(share)
        session.flush()
        session.add(SharePayload(share_id=share.id, ciphertext=b"x", nonce=b"n", crypto_version=0))
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
```

- [ ] **Step 6: Run the tests**

Run: `uv run pytest -v`
Expected: all tests in `test_schema.py` PASS. A first run before writing the migration would fail with missing tables. If the DB is unreachable, check `docker compose ps db`.

- [ ] **Step 7: Commit**

```bash
git add .gitignore .env.example compose.yaml infra/postgres backend/pyproject.toml backend/uv.lock backend/.python-version backend/app backend/alembic.ini backend/migrations backend/tests
git commit -m "feat(backend): project skeleton, settings, schema migration and test DB

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Pure helpers — base64url, usernames, share tokens

**Model:** sonnet

**Files:**
- Create: `backend/app/encoding.py`, `backend/app/usernames.py`, `backend/app/tokens.py`, `backend/app/timeutil.py`
- Test: `backend/tests/test_encoding.py`, `backend/tests/test_usernames.py`, `backend/tests/test_tokens.py`

**Interfaces:**
- Produces:
  - `app.encoding`: `class EncodingError(ValueError)`, `encode_b64url(data: bytes) -> str`, `decode_b64url(value: str, *, max_bytes: int) -> bytes` (rejects padding, non-alphabet chars, non-canonical encodings, and inputs longer than `max_bytes` would need).
  - `app.usernames`: `class InvalidUsername(ValueError)`, `canonicalize_username(raw: str) -> str`.
  - `app.tokens`: `ACCESS_TOKEN_BYTES = 32`, `ACCESS_TOKEN_LENGTH = 43`, `generate_access_token() -> tuple[str, bytes]` (encoded token, SHA-256 of raw bytes), `hash_access_token(token: str) -> bytes | None` (None when malformed).
  - `app.timeutil`: `to_utc(value: datetime) -> datetime`.

- [ ] **Step 1: Write failing tests**

`backend/tests/test_encoding.py`:
```python
import pytest

from app.encoding import EncodingError, decode_b64url, encode_b64url


def test_round_trip_without_padding():
    data = bytes(range(32))
    encoded = encode_b64url(data)
    assert "=" not in encoded and len(encoded) == 43
    assert decode_b64url(encoded, max_bytes=32) == data


def test_uses_url_safe_alphabet():
    assert encode_b64url(b"\xfb\xff") == "-_8"


def test_empty_string_decodes_to_empty_bytes():
    assert decode_b64url("", max_bytes=10) == b""


@pytest.mark.parametrize(
    "value",
    [
        "AAAA=",       # padding
        "AA+A",        # standard alphabet
        "AA/A",
        "A",           # impossible length (len % 4 == 1)
        "AB",          # non-canonical: trailing bits set
        "AA AA",       # whitespace
        "AAAA\n",      # trailing newline
        "ÁAAA",        # non-ASCII
    ],
)
def test_rejects_invalid_encodings(value):
    with pytest.raises(EncodingError):
        decode_b64url(value, max_bytes=100)


def test_rejects_input_longer_than_max_bytes_allows():
    with pytest.raises(EncodingError):
        decode_b64url(encode_b64url(b"x" * 33), max_bytes=32)


def test_accepts_exactly_max_bytes():
    assert len(decode_b64url(encode_b64url(b"x" * 65552), max_bytes=65552)) == 65552
```

`backend/tests/test_usernames.py`:
```python
import pytest

from app.usernames import InvalidUsername, canonicalize_username


@pytest.mark.parametrize(
    ("raw", "expected"),
    [("bgonzalez", "bgonzalez"), ("  BGonzalez \t", "bgonzalez"), ("a.b-c_9", "a.b-c_9"), ("x" * 64, "x" * 64)],
)
def test_canonicalizes(raw, expected):
    assert canonicalize_username(raw) == expected


@pytest.mark.parametrize(
    "raw",
    [
        "bgonzalez@example.com",  # email form is rejected, never stripped
        "bgonzalez@",
        "",
        "   ",
        "b gonzalez",
        ".bgonzalez",             # must start with a letter or digit
        "x" * 65,
        "ñandu",
        "bob\x00",
    ],
)
def test_rejects(raw):
    with pytest.raises(InvalidUsername):
        canonicalize_username(raw)
```

`backend/tests/test_tokens.py`:
```python
import hashlib
import re

from app.encoding import decode_b64url
from app.tokens import generate_access_token, hash_access_token


def test_generated_token_shape_and_hash():
    token, token_hash = generate_access_token()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    raw = decode_b64url(token, max_bytes=32)
    assert len(raw) == 32
    assert token_hash == hashlib.sha256(raw).digest()


def test_tokens_are_unique():
    assert len({generate_access_token()[0] for _ in range(100)}) == 100


def test_hash_access_token_matches_generation():
    token, token_hash = generate_access_token()
    assert hash_access_token(token) == token_hash


def test_hash_access_token_rejects_malformed():
    token, _ = generate_access_token()
    for bad in [token[:-1], token + "A", token[:-1] + "=", "+" + token[1:], "", "x" * 43 + "\n"]:
        assert hash_access_token(bad) is None
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_encoding.py tests/test_usernames.py tests/test_tokens.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.encoding'` (and similar).

- [ ] **Step 3: Implement**

`backend/app/encoding.py`:
```python
import base64
import binascii
import re

_B64URL_ALPHABET = re.compile(r"[A-Za-z0-9_-]*")


class EncodingError(ValueError):
    """Input is not canonical unpadded base64url within the allowed size."""


def encode_b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _max_encoded_length(max_bytes: int) -> int:
    return (max_bytes * 4 + 2) // 3


def decode_b64url(value: str, *, max_bytes: int) -> bytes:
    # Length check first so oversized input is rejected before any decoding work.
    if len(value) > _max_encoded_length(max_bytes):
        raise EncodingError("value too long")
    if not _B64URL_ALPHABET.fullmatch(value) or len(value) % 4 == 1:
        raise EncodingError("not unpadded base64url")
    try:
        data = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise EncodingError("not unpadded base64url") from exc
    if encode_b64url(data) != value:
        raise EncodingError("non-canonical base64url")
    return data
```

`backend/app/usernames.py`:
```python
import re

_USERNAME = re.compile(r"[a-z0-9][a-z0-9._-]{0,63}")


class InvalidUsername(ValueError):
    pass


def canonicalize_username(raw: str) -> str:
    """Trim, lowercase, then validate. Email-form input is rejected, never stripped of its domain."""
    value = raw.strip().lower()
    if "@" in value:
        raise InvalidUsername("email-form usernames are not accepted")
    if not _USERNAME.fullmatch(value):
        raise InvalidUsername("invalid username syntax")
    return value
```

`backend/app/tokens.py`:
```python
import hashlib
import secrets

from app.encoding import EncodingError, decode_b64url, encode_b64url

ACCESS_TOKEN_BYTES = 32
ACCESS_TOKEN_LENGTH = 43


def generate_access_token() -> tuple[str, bytes]:
    """Return (raw token for the creator, SHA-256 digest to persist). The raw token is never stored."""
    raw = secrets.token_bytes(ACCESS_TOKEN_BYTES)
    return encode_b64url(raw), hashlib.sha256(raw).digest()


def hash_access_token(token: str) -> bytes | None:
    """Digest of a presented token, or None if it is not a well-formed 43-char token."""
    if len(token) != ACCESS_TOKEN_LENGTH:
        return None
    try:
        raw = decode_b64url(token, max_bytes=ACCESS_TOKEN_BYTES)
    except EncodingError:
        return None
    if len(raw) != ACCESS_TOKEN_BYTES:
        return None
    return hashlib.sha256(raw).digest()
```

`backend/app/timeutil.py`:
```python
from datetime import UTC, datetime


def to_utc(value: datetime) -> datetime:
    """Normalize DB timestamps so API responses serialize as `...Z`."""
    return value.astimezone(UTC)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_encoding.py tests/test_usernames.py tests/test_tokens.py -v`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/encoding.py backend/app/usernames.py backend/app/tokens.py backend/app/timeutil.py backend/tests/test_encoding.py backend/tests/test_usernames.py backend/tests/test_tokens.py
git commit -m "feat(backend): base64url, username canonicalization and share token helpers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: App factory, error envelope, access log and security headers

**Model:** sonnet

**Files:**
- Create: `backend/app/errors.py`, `backend/app/middleware.py`, `backend/app/deps.py`, `backend/app/main.py`
- Modify: `backend/tests/helpers.py` (append), `backend/tests/conftest.py` (append)
- Test: `backend/tests/test_app.py`

**Interfaces:**
- Consumes: `Settings`, `make_session_factory` (Task 1).
- Produces:
  - `app.errors`: `AppError(status_code: int, code: str, message: str)`; constructors `authentication_required()`, `invalid_authentication()`, `admin_access_required()`, `share_not_found()`, `gone(code: str)` (code ∈ `share_already_consumed|share_expired|share_revoked|share_payload_deleted`), `invalid_request(message: str = ...)`, all returning `AppError`; `SECURITY_HEADERS: dict[str, str]`; `install_error_handlers(app)`.
  - `app.middleware.install_middleware(app)`: converts any unexpected exception into the generic 500 envelope, logging only the exception type on `chismoso.errors`. It logs `request method=<M> route=<route template> status=<code> duration_ms=<n>` on logger `chismoso.access` and sets `SECURITY_HEADERS` on every response.
  - `app.deps`: `get_settings(request) -> Settings`, `get_session(request) -> Iterator[Session]`.
  - `app.main.create_app(settings: Settings | None = None, *, session_factory: sessionmaker[Session] | None = None) -> FastAPI`. Task 4 adds a `verifier` keyword. uvicorn runs it with `--factory app.main:create_app`.
  - pytest fixtures `settings`, `app`, `client` (a `TestClient` with `raise_server_exceptions=False`); `tests.helpers.TEST_ISSUER`.

- [ ] **Step 1: Append test helpers and fixtures**

Append to `backend/tests/helpers.py`:
```python

TEST_ISSUER = "http://idp.test/realms/chismoso"
```

Append to `backend/tests/conftest.py`:
```python


from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app
from tests.helpers import TEST_ISSUER


@pytest.fixture
def settings():
    return Settings(
        database_url=TEST_DATABASE_URL,
        oidc_issuer=TEST_ISSUER,
        oidc_jwks_url="http://jwks.invalid/certs",
    )


@pytest.fixture
def app(settings, session_factory):
    return create_app(settings, session_factory=session_factory)


@pytest.fixture
def client(app):
    with TestClient(app, raise_server_exceptions=False) as test_client:
        yield test_client
```
(Move the new imports to the top of `conftest.py` with the others. The snippet only shows what to add.)

- [ ] **Step 2: Write failing tests**

`backend/tests/test_app.py`:
```python
import logging

import pytest
from fastapi.testclient import TestClient
from pydantic import BaseModel

from app.errors import share_not_found
from app.main import create_app


class ProbeBody(BaseModel):
    secret_field: str
    count: int


@pytest.fixture
def probe_client(settings, session_factory):
    app = create_app(settings, session_factory=session_factory)

    @app.post("/api/v1/probe/{item_id}")
    def probe(item_id: str, body: ProbeBody) -> dict[str, bool]:
        return {"ok": True}

    @app.get("/api/v1/probe-app-error")
    def probe_app_error() -> None:
        raise share_not_found()

    @app.get("/api/v1/probe-crash")
    def probe_crash() -> None:
        raise RuntimeError("boom-secret-value")

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def assert_security_headers(response):
    assert response.headers["cache-control"] == "no-store"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["referrer-policy"] == "no-referrer"


def test_success_response_has_security_headers(probe_client):
    response = probe_client.post("/api/v1/probe/abc123", json={"secret_field": "x", "count": 1})
    assert response.status_code == 200
    assert_security_headers(response)


def test_validation_error_uses_envelope_without_echoing_input(probe_client):
    response = probe_client.post(
        "/api/v1/probe/abc123", json={"secret_field": "s3cr3t-value", "count": "not-a-number"}
    )
    assert response.status_code == 422
    assert response.json() == {"error": {"code": "invalid_request", "message": "The request is invalid."}}
    assert "s3cr3t-value" not in response.text
    assert_security_headers(response)


def test_malformed_json_is_invalid_request(probe_client):
    response = probe_client.post(
        "/api/v1/probe/abc", content=b"{not json", headers={"content-type": "application/json"}
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_app_error_uses_envelope(probe_client):
    response = probe_client.get("/api/v1/probe-app-error")
    assert response.status_code == 404
    assert response.json() == {"error": {"code": "share_not_found", "message": "Share not found."}}


def test_unhandled_error_is_generic_500_without_details(probe_client, caplog):
    caplog.set_level(logging.DEBUG)
    response = probe_client.get("/api/v1/probe-crash")
    assert response.status_code == 500
    assert response.json() == {"error": {"code": "internal_error", "message": "An internal error occurred."}}
    assert "boom-secret-value" not in response.text
    assert "boom-secret-value" not in caplog.text
    assert_security_headers(response)


def test_unknown_route_uses_envelope(probe_client):
    response = probe_client.get("/api/v1/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_access_log_uses_route_template_not_concrete_path(probe_client, caplog):
    caplog.set_level(logging.INFO, logger="chismoso")
    probe_client.post("/api/v1/probe/abc123", json={"secret_field": "x", "count": 1})
    access_lines = [r.getMessage() for r in caplog.records if r.name == "chismoso.access"]
    assert any("route=/api/v1/probe/{item_id}" in line and "status=200" in line for line in access_lines)
    assert not any("abc123" in line for line in access_lines)


def test_openapi_and_docs_are_disabled(probe_client):
    assert probe_client.get("/openapi.json").status_code == 404
    assert probe_client.get("/docs").status_code == 404
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_app.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.main'`.

- [ ] **Step 4: Implement**

`backend/app/errors.py`:
```python
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

SECURITY_HEADERS = {
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
}


class AppError(Exception):
    """Application error rendered as the uniform envelope. Messages never contain submitted values."""

    def __init__(self, status_code: int, code: str, message: str) -> None:
        super().__init__(code)
        self.status_code = status_code
        self.code = code
        self.message = message


def authentication_required() -> AppError:
    return AppError(401, "authentication_required", "Authentication is required.")


def invalid_authentication() -> AppError:
    return AppError(401, "invalid_authentication", "The authentication token is invalid.")


def admin_access_required() -> AppError:
    return AppError(403, "admin_access_required", "Administrator access is required.")


def share_not_found() -> AppError:
    return AppError(404, "share_not_found", "Share not found.")


_GONE_MESSAGES = {
    "share_already_consumed": "This share has already been consumed.",
    "share_expired": "This share has expired.",
    "share_revoked": "This share has been revoked.",
    "share_payload_deleted": "This share's content is no longer available.",
}


def gone(code: str) -> AppError:
    return AppError(410, code, _GONE_MESSAGES[code])


def invalid_request(message: str = "The request is invalid.") -> AppError:
    return AppError(422, "invalid_request", message)


def error_response(status_code: int, code: str, message: str) -> JSONResponse:
    return JSONResponse(
        status_code=status_code,
        content={"error": {"code": code, "message": message}},
        headers=SECURITY_HEADERS,
    )


def install_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError) -> JSONResponse:
        return error_response(exc.status_code, exc.code, exc.message)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(request: Request, exc: RequestValidationError) -> JSONResponse:
        # Never include exc.errors(): it echoes submitted values.
        return error_response(422, "invalid_request", "The request is invalid.")

    @app.exception_handler(StarletteHTTPException)
    async def handle_http_error(request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "invalid_request")
        return error_response(exc.status_code, code, "The request could not be processed.")
```
(Unexpected exceptions are deliberately **not** handled here. An `Exception` handler runs in Starlette's `ServerErrorMiddleware`, which re-raises afterwards, so uvicorn would log the message and traceback. `middleware.py` converts them instead.)

`backend/app/middleware.py`:
```python
import logging
import time

from fastapi import FastAPI, Request

from app.errors import SECURITY_HEADERS, error_response

access_logger = logging.getLogger("chismoso.access")
error_logger = logging.getLogger("chismoso.errors")


def install_middleware(app: FastAPI) -> None:
    @app.middleware("http")
    async def access_log_and_security_headers(request: Request, call_next):
        started = time.perf_counter()
        try:
            response = await call_next(request)
        except Exception as exc:
            # Converted here and not re-raised: the server would otherwise log the exception message
            # and traceback, which may carry request data. Log the type only.
            error_logger.error("unhandled_error type=%s", type(exc).__name__)
            response = error_response(500, "internal_error", "An internal error occurred.")
        for name, value in SECURITY_HEADERS.items():
            response.headers[name] = value
        # Route template only: never the concrete path, query, headers or body.
        route = request.scope.get("route")
        access_logger.info(
            "request method=%s route=%s status=%d duration_ms=%.1f",
            request.method,
            getattr(route, "path", "<unmatched>"),
            response.status_code,
            (time.perf_counter() - started) * 1000,
        )
        return response
```

`backend/app/deps.py`:
```python
from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session

from app.config import Settings


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_session(request: Request) -> Iterator[Session]:
    session = request.app.state.session_factory()
    try:
        yield session
    finally:
        session.close()
```

`backend/app/main.py`:
```python
import logging

from fastapi import FastAPI
from sqlalchemy.orm import Session, sessionmaker

from app.config import Settings
from app.db import make_session_factory
from app.errors import install_error_handlers
from app.middleware import install_middleware


def _configure_logging() -> None:
    app_logger = logging.getLogger("chismoso")
    if not app_logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(name)s %(message)s"))
        app_logger.addHandler(handler)
    app_logger.setLevel(logging.INFO)
    # Never emit SQL statements/parameters, even if the root logger is lowered.
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)


def create_app(
    settings: Settings | None = None,
    *,
    session_factory: sessionmaker[Session] | None = None,
) -> FastAPI:
    settings = settings or Settings()
    _configure_logging()
    app = FastAPI(title="Chismoso", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.settings = settings
    app.state.session_factory = session_factory or make_session_factory(settings.database_url)
    install_error_handlers(app)
    install_middleware(app)
    return app
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest -v`
Expected: PASS (all tests so far). If the route-template test fails because `scope["route"]` is missing, check that FastAPI's `APIRoute.matches` sets `"route"` in the child scope for the installed version, and adapt the lookup. Do not fall back to `request.url.path`.

- [ ] **Step 6: Commit**

```bash
git add backend/app/errors.py backend/app/middleware.py backend/app/deps.py backend/app/main.py backend/tests/helpers.py backend/tests/conftest.py backend/tests/test_app.py
git commit -m "feat(backend): app factory, uniform error envelope, access log and security headers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Keycloak JWT validation and auth dependencies

**Model:** opus

**Files:**
- Create: `backend/app/auth.py`
- Modify: `backend/app/main.py` (verifier wiring), `backend/tests/helpers.py` (append), `backend/tests/conftest.py` (append + replace `app` fixture)
- Test: `backend/tests/test_auth.py`

**Interfaces:**
- Consumes: `Settings.jwks_url`, `canonicalize_username`, error constructors, `get_settings`.
- Produces:
  - `app.auth.Principal(username: str, roles: frozenset[str])` (frozen dataclass).
  - `app.auth.TokenVerifier(settings, signing_key_resolver: Callable[[str], Any] | None = None)` with `.verify(token: str) -> Principal`.
  - FastAPI dependencies `app.auth.current_principal` and `app.auth.require_admin`, plus the aliases `CurrentPrincipal = Annotated[Principal, Depends(current_principal)]` and `AdminPrincipal = Annotated[Principal, Depends(require_admin)]`.
  - `create_app(..., verifier: TokenVerifier | None = None)`.
  - Test fixtures `signing_key`, `verifier`, `auth_headers(username="aperez", roles=())`; `tests.helpers.make_token(private_key, **kw)` and `TEST_KID`.

- [ ] **Step 1: Test helpers and fixtures**

Append to `backend/tests/helpers.py`:
```python

import time

import jwt

TEST_KID = "test-key"


def make_token(
    private_key,
    *,
    username: str | None = "aperez",
    roles=(),
    issuer: str = TEST_ISSUER,
    audience=("chismoso-api", "account"),
    expires_in: int = 300,
    kid: str = TEST_KID,
    extra: dict | None = None,
    drop: tuple[str, ...] = (),
    algorithm: str = "RS256",
) -> str:
    now = int(time.time())
    claims = {
        "iss": issuer,
        "aud": list(audience) if isinstance(audience, (list, tuple)) else audience,
        "exp": now + expires_in,
        "iat": now,
        "preferred_username": username,
        "resource_access": {"chismoso": {"roles": list(roles)}},
    }
    if extra:
        claims.update(extra)
    for claim in drop:
        claims.pop(claim, None)
    return jwt.encode(claims, private_key, algorithm=algorithm, headers={"kid": kid})
```

Append to `backend/tests/conftest.py` (imports at top) and **replace** the existing `app` fixture:
```python
import jwt
from cryptography.hazmat.primitives.asymmetric import rsa

from app.auth import TokenVerifier
from tests.helpers import TEST_KID, make_token


@pytest.fixture(scope="session")
def signing_key():
    return rsa.generate_private_key(public_exponent=65537, key_size=2048)


@pytest.fixture
def verifier(settings, signing_key):
    public_key = signing_key.public_key()

    def resolve(token: str):
        if jwt.get_unverified_header(token).get("kid") != TEST_KID:
            raise jwt.PyJWKClientError("unknown signing key")
        return public_key

    return TokenVerifier(settings, signing_key_resolver=resolve)


@pytest.fixture
def app(settings, session_factory, verifier):
    return create_app(settings, session_factory=session_factory, verifier=verifier)


@pytest.fixture
def auth_headers(signing_key):
    def _headers(username: str = "aperez", roles=()) -> dict[str, str]:
        return {"Authorization": f"Bearer {make_token(signing_key, username=username, roles=roles)}"}

    return _headers
```

- [ ] **Step 2: Write failing tests**

`backend/tests/test_auth.py`:
```python
import json
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from app.auth import AdminPrincipal, CurrentPrincipal, Principal, TokenVerifier
from app.config import Settings
from app.errors import AppError
from app.main import create_app
from tests.helpers import TEST_DATABASE_URL, TEST_ISSUER, TEST_KID, make_token


def test_valid_token_yields_canonical_principal(verifier, signing_key):
    principal = verifier.verify(make_token(signing_key, username="APerez", roles=["chismoso-admin", 7]))
    assert principal == Principal(username="aperez", roles=frozenset({"chismoso-admin"}))


def test_audience_may_be_a_plain_string(verifier, signing_key):
    assert verifier.verify(make_token(signing_key, audience="chismoso-api")).username == "aperez"


@pytest.mark.parametrize(
    "kwargs",
    [
        {"issuer": "http://idp.localhost:8080/realms/other"},
        {"issuer": "http://keycloak:8080/realms/chismoso"},  # internal alias is NOT a valid issuer
        {"audience": ("account",)},
        {"audience": "chismoso"},
        {"expires_in": -10},
        {"extra": {"nbf": 32503680000}},  # not yet valid (year 3000)
        {"drop": ("exp",)},
        {"drop": ("aud",)},
        {"drop": ("iss",)},
        {"kid": "unknown-key"},
        {"username": None},
        {"username": "aperez@example.com"},
        {"username": "not valid"},
    ],
)
def test_invalid_tokens_are_rejected(verifier, signing_key, kwargs):
    with pytest.raises(AppError) as info:
        verifier.verify(make_token(signing_key, **kwargs))
    assert (info.value.status_code, info.value.code) == (401, "invalid_authentication")


def test_token_signed_by_another_key_is_rejected(verifier):
    other_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    with pytest.raises(AppError):
        verifier.verify(make_token(other_key))


def test_hs256_token_is_rejected(verifier):
    token = jwt.encode(
        {"iss": TEST_ISSUER, "aud": "chismoso-api", "exp": 4102444800, "preferred_username": "aperez"},
        "shared-secret",
        algorithm="HS256",
        headers={"kid": TEST_KID},
    )
    with pytest.raises(AppError):
        verifier.verify(token)


@pytest.mark.parametrize("garbage", ["", "not-a-jwt", "a.b.c"])
def test_garbage_tokens_are_rejected(verifier, garbage):
    with pytest.raises(AppError):
        verifier.verify(garbage)


@pytest.fixture
def auth_probe(settings, session_factory, verifier):
    app = create_app(settings, session_factory=session_factory, verifier=verifier)

    @app.get("/api/v1/probe-user")
    def probe_user(principal: CurrentPrincipal) -> dict[str, str]:
        return {"username": principal.username}

    @app.get("/api/v1/probe-admin")
    def probe_admin(principal: AdminPrincipal) -> dict[str, str]:
        return {"username": principal.username}

    with TestClient(app, raise_server_exceptions=False) as client:
        yield client


def test_missing_authorization_header(auth_probe):
    response = auth_probe.get("/api/v1/probe-user")
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "authentication_required"


@pytest.mark.parametrize("header", ["Basic abc", "Bearer", "Bearer    ", "token abc"])
def test_malformed_authorization_header(auth_probe, header):
    response = auth_probe.get("/api/v1/probe-user", headers={"Authorization": header})
    assert response.status_code == 401
    assert response.json()["error"]["code"] == "invalid_authentication"


def test_authenticated_request(auth_probe, auth_headers):
    response = auth_probe.get("/api/v1/probe-user", headers=auth_headers("bgonzalez"))
    assert response.json() == {"username": "bgonzalez"}


def test_admin_route_requires_admin_role(auth_probe, auth_headers):
    response = auth_probe.get("/api/v1/probe-admin", headers=auth_headers("dlopez"))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "admin_access_required"
    ok = auth_probe.get("/api/v1/probe-admin", headers=auth_headers("flapinto", roles=["chismoso-admin"]))
    assert ok.json() == {"username": "flapinto"}


def test_admin_role_from_another_client_does_not_count(auth_probe, signing_key):
    token = make_token(signing_key, username="dlopez", extra={"resource_access": {"other": {"roles": ["chismoso-admin"]}}})
    response = auth_probe.get("/api/v1/probe-admin", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 403


def _serve_jwks(public_key):
    jwk = jwt.algorithms.RSAAlgorithm.to_jwk(public_key, as_dict=True)
    body = json.dumps({"keys": [{**jwk, "kid": TEST_KID, "use": "sig", "alg": "RS256"}]}).encode()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(body)

        def log_message(self, *args):
            pass

    server = HTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return server


def test_default_resolver_fetches_jwks_from_configured_url(signing_key):
    server = _serve_jwks(signing_key.public_key())
    try:
        settings = Settings(
            database_url=TEST_DATABASE_URL,
            oidc_issuer=TEST_ISSUER,
            oidc_jwks_url=f"http://127.0.0.1:{server.server_port}/certs",
        )
        assert TokenVerifier(settings).verify(make_token(signing_key)).username == "aperez"
    finally:
        server.shutdown()


def test_jwks_url_defaults_to_issuer_certs_endpoint():
    settings = Settings(database_url=TEST_DATABASE_URL, oidc_issuer="https://idp.example/realms/chismoso/")
    assert settings.jwks_url == "https://idp.example/realms/chismoso/protocol/openid-connect/certs"
    blank = Settings(database_url=TEST_DATABASE_URL, oidc_issuer=TEST_ISSUER, oidc_jwks_url="")
    assert blank.jwks_url == f"{TEST_ISSUER}/protocol/openid-connect/certs"


def test_unreachable_jwks_is_a_server_error_not_a_401(signing_key, session_factory):
    settings = Settings(database_url=TEST_DATABASE_URL, oidc_issuer=TEST_ISSUER, oidc_jwks_url="http://127.0.0.1:9/certs")
    app = create_app(settings, session_factory=session_factory)

    @app.get("/api/v1/probe-user")
    def probe_user(principal: CurrentPrincipal) -> dict[str, str]:
        return {"username": principal.username}

    with TestClient(app, raise_server_exceptions=False) as client:
        response = client.get("/api/v1/probe-user", headers={"Authorization": f"Bearer {make_token(signing_key)}"})
    assert response.status_code == 500
    assert response.json()["error"]["code"] == "internal_error"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_auth.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.auth'`.

- [ ] **Step 4: Implement**

`backend/app/auth.py`:
```python
from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, Request

from app.config import Settings
from app.deps import get_settings
from app.errors import admin_access_required, authentication_required, invalid_authentication
from app.usernames import InvalidUsername, canonicalize_username

ALLOWED_ALGORITHMS = ["RS256"]

SigningKeyResolver = Callable[[str], Any]


@dataclass(frozen=True)
class Principal:
    username: str
    roles: frozenset[str]


class TokenVerifier:
    """Validates Keycloak access tokens: JWKS signature, iss, exp/nbf and audience membership."""

    def __init__(self, settings: Settings, signing_key_resolver: SigningKeyResolver | None = None) -> None:
        self._settings = settings
        if signing_key_resolver is None:
            jwk_client = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=300, timeout=5)

            def signing_key_resolver(token: str) -> Any:
                return jwk_client.get_signing_key_from_jwt(token).key

        self._resolve_key = signing_key_resolver

    def verify(self, token: str) -> Principal:
        try:
            key = self._resolve_key(token)
        except jwt.PyJWKClientConnectionError:
            raise  # IdP unreachable is a server-side failure (500), not a bad credential.
        except (jwt.PyJWKClientError, jwt.PyJWTError):
            raise invalid_authentication() from None
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=ALLOWED_ALGORITHMS,
                issuer=self._settings.oidc_issuer,
                # PyJWT accepts the token when this value is a member of a list `aud`.
                audience=self._settings.oidc_expected_audience,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            raise invalid_authentication() from None
        username = claims.get("preferred_username")
        if not isinstance(username, str):
            raise invalid_authentication()
        try:
            canonical = canonicalize_username(username)
        except InvalidUsername:
            raise invalid_authentication() from None
        return Principal(username=canonical, roles=frozenset(_client_roles(claims, self._settings.oidc_admin_client_id)))


def _client_roles(claims: dict[str, Any], client_id: str) -> list[str]:
    resource_access = claims.get("resource_access")
    client = resource_access.get(client_id) if isinstance(resource_access, dict) else None
    roles = client.get("roles") if isinstance(client, dict) else None
    if not isinstance(roles, list):
        return []
    return [role for role in roles if isinstance(role, str)]


def get_verifier(request: Request) -> TokenVerifier:
    return request.app.state.verifier


def current_principal(
    request: Request, verifier: Annotated[TokenVerifier, Depends(get_verifier)]
) -> Principal:
    header = request.headers.get("authorization")
    if header is None:
        raise authentication_required()
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise invalid_authentication()
    return verifier.verify(token)


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def require_admin(principal: CurrentPrincipal, settings: Annotated[Settings, Depends(get_settings)]) -> Principal:
    if settings.oidc_admin_role not in principal.roles:
        raise admin_access_required()
    return principal


AdminPrincipal = Annotated[Principal, Depends(require_admin)]
```

Modify `backend/app/main.py`: add `from app.auth import TokenVerifier`, add keyword parameter `verifier: TokenVerifier | None = None` to `create_app`, and after setting `session_factory` add:
```python
    app.state.verifier = verifier or TokenVerifier(settings)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest -v`
Expected: PASS. If `jwt.PyJWKClientConnectionError`, the `timeout`/`lifespan` kwargs, or `RSAAlgorithm.to_jwk(..., as_dict=True)` differ in the installed PyJWT, adapt per Global Constraints.

- [ ] **Step 6: Commit**

```bash
git add backend/app/auth.py backend/app/main.py backend/tests/helpers.py backend/tests/conftest.py backend/tests/test_auth.py
git commit -m "feat(backend): Keycloak JWT validation with JWKS, audience membership and admin role

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
### Task 5: Create Share endpoint — `POST /api/v1/shares`

**Model:** sonnet

**Files:**
- Create: `backend/app/shares.py`
- Modify: `backend/app/main.py` (include router), `backend/tests/helpers.py` (append)
- Test: `backend/tests/test_create_share.py`

**Interfaces:**
- Consumes: `CurrentPrincipal`, `get_session`, `get_settings`, `decode_b64url`, `canonicalize_username`, `generate_access_token`, `to_utc`, `invalid_request`, models.
- Produces:
  - `app.shares.router` (`APIRouter(prefix="/api/v1")`).
  - `app.shares.ValidatedShare` (frozen dataclass: `ciphertext: bytes, nonce: bytes, crypto_version: int, expires_in_minutes: int, recipients: list[str], shared_token: bool, label: str | None`).
  - `app.shares.validate_create_request(body: CreateShareRequest, settings: Settings) -> ValidatedShare`.
  - `app.shares.create_share(session: Session, *, creator: str, data: ValidatedShare) -> CreatedShare`, where `CreatedShare(share_id: uuid.UUID, created_at: datetime, expires_at: datetime, grants: list[tuple[str, str]])` holds (recipient, raw token) pairs. Task 6 tests call this directly.
  - `tests.helpers.valid_body(**overrides) -> dict` and `tests.helpers.create_via_api(client, headers, **overrides) -> dict` (returns the response JSON).

- [ ] **Step 1: Test helpers**

Append to `backend/tests/helpers.py`:
```python

from app.encoding import encode_b64url


def valid_body(**overrides) -> dict:
    body = {
        "ciphertext": encode_b64url(b"\x01" * 48),
        "nonce": encode_b64url(b"\x02" * 12),
        "crypto_version": 1,
        "expires_in_minutes": 60,
        "recipients": ["bgonzalez", "csaul"],
        "shared_token": False,
        "label": "Staging database password",
    }
    body.update(overrides)
    return body


def create_via_api(client, headers: dict[str, str], **overrides) -> dict:
    response = client.post("/api/v1/shares", json=valid_body(**overrides), headers=headers)
    assert response.status_code == 201, response.text
    return response.json()
```

- [ ] **Step 2: Write failing tests**

`backend/tests/test_create_share.py`:
```python
import hashlib
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import func, select

from app.encoding import decode_b64url, encode_b64url
from app.models import RecipientGrant, Share, SharePayload
from tests.helpers import valid_body

URL = "/api/v1/shares"


def row_counts(session_factory) -> tuple[int, int, int]:
    with session_factory() as session:
        return tuple(
            session.scalar(select(func.count()).select_from(model))
            for model in (Share, SharePayload, RecipientGrant)
        )


def test_create_with_individual_tokens(client, auth_headers, session_factory):
    body = valid_body()
    response = client.post(URL, json=body, headers=auth_headers("aperez"))

    assert response.status_code == 201
    assert response.headers["cache-control"] == "no-store"
    data = response.json()
    assert set(data) == {"share_id", "crypto_version", "created_at", "expires_at", "grants"}
    assert data["crypto_version"] == 1
    assert data["created_at"].endswith("Z") and data["expires_at"].endswith("Z")
    assert [g["recipient"] for g in data["grants"]] == ["bgonzalez", "csaul"]
    tokens = [g["access_token"] for g in data["grants"]]
    assert all(len(t) == 43 for t in tokens) and tokens[0] != tokens[1]

    with session_factory() as session:
        share = session.get(Share, uuid.UUID(data["share_id"]))
        db_now = session.scalar(select(func.now()))
        assert share.creator_identity == "aperez"
        assert share.label == body["label"]
        assert share.expires_at - share.created_at == timedelta(minutes=60)
        assert abs(db_now - share.created_at) < timedelta(seconds=10)
        assert share.revoked_at is None and share.payload_deleted_at is None
        payload = session.get(SharePayload, share.id)
        assert payload.ciphertext == b"\x01" * 48
        assert payload.nonce == b"\x02" * 12
        assert payload.crypto_version == 1
        grants = {
            g.recipient_identity: g
            for g in session.scalars(select(RecipientGrant).where(RecipientGrant.share_id == share.id))
        }
    for grant in data["grants"]:
        raw = decode_b64url(grant["access_token"], max_bytes=32)
        stored = grants[grant["recipient"]]
        assert stored.access_token_hash == hashlib.sha256(raw).digest()
        assert stored.consumed_at is None


def test_shared_token_mode_reuses_one_token_on_independent_grants(client, auth_headers, session_factory):
    data = client.post(URL, json=valid_body(shared_token=True), headers=auth_headers()).json()
    tokens = {g["access_token"] for g in data["grants"]}
    assert len(tokens) == 1
    with session_factory() as session:
        hashes = session.scalars(select(RecipientGrant.access_token_hash)).all()
    assert len(hashes) == 2 and len(set(hashes)) == 1


def test_recipients_are_trimmed_and_lowercased(client, auth_headers):
    data = client.post(URL, json=valid_body(recipients=[" BGonzalez ", "CSAUL"]), headers=auth_headers()).json()
    assert [g["recipient"] for g in data["grants"]] == ["bgonzalez", "csaul"]


def test_unknown_positive_crypto_version_is_stored_opaquely(client, auth_headers, session_factory):
    data = client.post(URL, json=valid_body(crypto_version=999), headers=auth_headers()).json()
    assert data["crypto_version"] == 999
    with session_factory() as session:
        assert session.get(SharePayload, uuid.UUID(data["share_id"])).crypto_version == 999


@pytest.mark.parametrize(
    "overrides",
    [
        {"recipients": []},
        {"recipients": ["bgonzalez", " BGonzalez "]},
        {"recipients": ["bgonzalez@example.com"]},
        {"recipients": ["b gonzalez"]},
        {"recipients": [""]},
        {"recipients": "bgonzalez"},
        {"shared_token": "true"},
        {"shared_token": None},
        {"crypto_version": 0},
        {"crypto_version": -1},
        {"crypto_version": 2**31},
        {"crypto_version": True},
        {"crypto_version": "1"},
        {"expires_in_minutes": 9},
        {"expires_in_minutes": 43201},
        {"expires_in_minutes": 10.5},
        {"expires_in_minutes": 10**30},
        {"ciphertext": "AAAA="},
        {"ciphertext": "AA+A"},
        {"ciphertext": ""},
        {"nonce": ""},
        {"nonce": "A"},
        {"label": "x" * 257},
        {"label": "bad\x00label"},
    ],
    ids=lambda o: repr(o)[:60],
)
def test_invalid_input_is_rejected_without_writes(client, auth_headers, session_factory, overrides):
    response = client.post(URL, json=valid_body(**overrides), headers=auth_headers())
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"
    assert row_counts(session_factory) == (0, 0, 0)


def test_shared_token_is_required(client, auth_headers):
    body = valid_body()
    del body["shared_token"]
    assert client.post(URL, json=body, headers=auth_headers()).status_code == 422


def test_too_many_recipients(client, auth_headers):
    recipients = [f"user{i:03d}" for i in range(101)]
    assert client.post(URL, json=valid_body(recipients=recipients), headers=auth_headers()).status_code == 422
    assert client.post(URL, json=valid_body(recipients=recipients[:100]), headers=auth_headers()).status_code == 201


def test_expiry_bounds_are_inclusive(client, auth_headers):
    for minutes in (10, 43200):
        assert client.post(URL, json=valid_body(expires_in_minutes=minutes), headers=auth_headers()).status_code == 201


def test_ciphertext_size_limit_is_generic_and_inclusive(client, auth_headers):
    # 65,536-byte plaintext + 16-byte GCM tag = the default 65,552-byte ceiling.
    at_limit = encode_b64url(b"\x03" * 65552)
    over_limit = encode_b64url(b"\x03" * 65553)
    assert client.post(URL, json=valid_body(ciphertext=at_limit), headers=auth_headers()).status_code == 201
    assert client.post(URL, json=valid_body(ciphertext=over_limit), headers=auth_headers()).status_code == 422


def test_label_rules(client, auth_headers, session_factory):
    blank = client.post(URL, json=valid_body(label="   "), headers=auth_headers()).json()
    missing_body = valid_body()
    del missing_body["label"]
    missing = client.post(URL, json=missing_body, headers=auth_headers()).json()
    at_limit = client.post(URL, json=valid_body(label="x" * 256), headers=auth_headers())
    assert at_limit.status_code == 201
    with session_factory() as session:
        assert session.get(Share, uuid.UUID(blank["share_id"])).label is None
        assert session.get(Share, uuid.UUID(missing["share_id"])).label is None


def test_requires_authentication(client, session_factory):
    response = client.post(URL, json=valid_body())
    assert response.status_code == 401
    assert row_counts(session_factory) == (0, 0, 0)


def test_validation_errors_do_not_echo_submitted_values(client, auth_headers):
    response = client.post(URL, json=valid_body(recipients=["leaky@example.com"], label="L" * 300), headers=auth_headers())
    assert "leaky" not in response.text and "LLLL" not in response.text


def test_failure_mid_creation_rolls_back_everything(client, auth_headers, session_factory, monkeypatch):
    import app.shares as shares_module

    real_generate = shares_module.generate_access_token
    calls = {"count": 0}

    def flaky_generate():
        calls["count"] += 1
        if calls["count"] == 2:
            raise RuntimeError("token generation failed")
        return real_generate()

    monkeypatch.setattr(shares_module, "generate_access_token", flaky_generate)
    response = client.post(URL, json=valid_body(), headers=auth_headers())

    assert response.status_code == 500
    assert "access_token" not in response.text
    assert row_counts(session_factory) == (0, 0, 0)
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_create_share.py -v`
Expected: FAIL. Responses are 404 because the route does not exist yet.

- [ ] **Step 4: Implement**

`backend/app/shares.py`:
```python
import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, StrictBool, StrictInt, StrictStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CurrentPrincipal
from app.config import Settings
from app.deps import get_session, get_settings
from app.encoding import EncodingError, decode_b64url
from app.errors import invalid_request
from app.models import RecipientGrant, Share, SharePayload
from app.timeutil import to_utc
from app.tokens import generate_access_token
from app.usernames import InvalidUsername, canonicalize_username

MAX_POSTGRES_INTEGER = 2_147_483_647

router = APIRouter(prefix="/api/v1")


class CreateShareRequest(BaseModel):
    ciphertext: StrictStr
    nonce: StrictStr
    crypto_version: StrictInt
    expires_in_minutes: StrictInt
    recipients: list[StrictStr]
    shared_token: StrictBool
    label: StrictStr | None = None


class GrantOut(BaseModel):
    recipient: str
    access_token: str


class CreateShareResponse(BaseModel):
    share_id: uuid.UUID
    crypto_version: int
    created_at: datetime
    expires_at: datetime
    grants: list[GrantOut]


@dataclass(frozen=True)
class ValidatedShare:
    ciphertext: bytes
    nonce: bytes
    crypto_version: int
    expires_in_minutes: int
    recipients: list[str]
    shared_token: bool
    label: str | None


@dataclass(frozen=True)
class CreatedShare:
    share_id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    grants: list[tuple[str, str]]  # (recipient, raw access token)


def validate_create_request(body: CreateShareRequest, settings: Settings) -> ValidatedShare:
    try:
        ciphertext = decode_b64url(body.ciphertext, max_bytes=settings.max_ciphertext_bytes)
        nonce = decode_b64url(body.nonce, max_bytes=settings.max_nonce_bytes)
    except EncodingError:
        raise invalid_request("ciphertext and nonce must be unpadded base64url within size limits.") from None
    if not ciphertext or not nonce:
        raise invalid_request("ciphertext and nonce must not be empty.")
    # Server stays version-agnostic: any positive integer that fits the column is accepted.
    if not 1 <= body.crypto_version <= MAX_POSTGRES_INTEGER:
        raise invalid_request("crypto_version must be a positive integer.")
    if not settings.min_expires_in_minutes <= body.expires_in_minutes <= settings.max_expires_in_minutes:
        raise invalid_request("expires_in_minutes is out of range.")
    if not body.recipients:
        raise invalid_request("At least one recipient is required.")
    if len(body.recipients) > settings.max_recipients_per_share:
        raise invalid_request("Too many recipients.")
    try:
        recipients = [canonicalize_username(raw) for raw in body.recipients]
    except InvalidUsername:
        raise invalid_request("Recipients must be valid usernames, not email addresses.") from None
    if len(set(recipients)) != len(recipients):
        raise invalid_request("Duplicate recipient usernames are not allowed.")
    label = (body.label or "").strip() or None
    if label is not None and len(label) > settings.max_label_length:
        raise invalid_request("label is too long.")
    if label is not None and "\x00" in label:
        raise invalid_request("label contains invalid characters.")
    return ValidatedShare(
        ciphertext=ciphertext,
        nonce=nonce,
        crypto_version=body.crypto_version,
        expires_in_minutes=body.expires_in_minutes,
        recipients=recipients,
        shared_token=body.shared_token,
        label=label,
    )


def create_share(session: Session, *, creator: str, data: ValidatedShare) -> CreatedShare:
    """Insert Share, SharePayload and one grant per recipient in one transaction."""
    grants: list[tuple[str, str]] = []
    with session.begin():
        db_now = session.scalar(select(func.now()))
        share = Share(
            creator_identity=creator,
            label=data.label,
            created_at=db_now,
            expires_at=db_now + timedelta(minutes=data.expires_in_minutes),
        )
        session.add(share)
        session.flush()
        session.add(
            SharePayload(
                share_id=share.id,
                ciphertext=data.ciphertext,
                nonce=data.nonce,
                crypto_version=data.crypto_version,
            )
        )
        shared = generate_access_token() if data.shared_token else None
        for recipient in data.recipients:
            token, token_hash = shared or generate_access_token()
            session.add(
                RecipientGrant(share_id=share.id, recipient_identity=recipient, access_token_hash=token_hash)
            )
            grants.append((recipient, token))
    # Committed: only now may raw tokens leave this function.
    return CreatedShare(share.id, share.created_at, share.expires_at, grants)


@router.post("/shares", status_code=status.HTTP_201_CREATED, response_model=CreateShareResponse)
def post_share(
    body: CreateShareRequest,
    principal: CurrentPrincipal,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CreateShareResponse:
    data = validate_create_request(body, settings)
    created = create_share(session, creator=principal.username, data=data)
    return CreateShareResponse(
        share_id=created.share_id,
        crypto_version=data.crypto_version,
        created_at=to_utc(created.created_at),
        expires_at=to_utc(created.expires_at),
        grants=[GrantOut(recipient=r, access_token=t) for r, t in created.grants],
    )
```

Modify `backend/app/main.py`: add `from app import shares` and, after `install_middleware(app)`, `app.include_router(shares.router)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest -v`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/app/shares.py backend/app/main.py backend/tests/helpers.py backend/tests/test_create_share.py
git commit -m "feat(backend): create share endpoint with all-or-nothing transaction

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Consume endpoint — `POST /api/v1/access/consume` (atomic, Share → Grant locks)

**Model:** opus

**Files:**
- Create: `backend/app/consume.py`
- Modify: `backend/app/main.py` (include router)
- Test: `backend/tests/test_consume.py`, `backend/tests/test_consume_concurrency.py`

**Interfaces:**
- Consumes: `hash_access_token`, `encode_b64url`, `share_not_found`, `gone`, `CurrentPrincipal`, `get_session`, models; Task 5's `create_share`, `ValidatedShare`, `create_via_api`.
- Produces: `app.consume.router`; `app.consume.consume_grant(session: Session, token_hash: bytes, recipient_identity: str) -> ConsumedPayload`, where `ConsumedPayload(crypto_version: int, ciphertext: bytes, nonce: bytes)`. It raises `AppError` (404 `share_not_found`, or 410 with a specific code).

- [ ] **Step 1: Write failing HTTP-level tests**

`backend/tests/test_consume.py`:
```python
import uuid
from datetime import timedelta

import pytest
from sqlalchemy import delete, func, select, update

from app.encoding import encode_b64url
from app.models import RecipientGrant, Share, SharePayload
from app.tokens import generate_access_token
from tests.helpers import create_via_api, valid_body

URL = "/api/v1/access/consume"


def consume(client, headers, token):
    return client.post(URL, json={"access_token": token}, headers=headers)


def tokens_of(created) -> dict[str, str]:
    return {g["recipient"]: g["access_token"] for g in created["grants"]}


def grant_consumed_at(session_factory, share_id, recipient):
    with session_factory() as session:
        return session.scalar(
            select(RecipientGrant.consumed_at).where(
                RecipientGrant.share_id == uuid.UUID(share_id),
                RecipientGrant.recipient_identity == recipient,
            )
        )


def update_share(session_factory, share_id, **values):
    with session_factory() as session, session.begin():
        session.execute(update(Share).where(Share.id == uuid.UUID(share_id)).values(**values))


def test_recipient_consumes_once_and_gets_encrypted_payload(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers("aperez"))
    token = tokens_of(created)["bgonzalez"]
    with session_factory() as session:
        before = session.scalar(select(func.clock_timestamp()))

    response = consume(client, auth_headers("bgonzalez"), token)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.json() == {
        "crypto_version": 1,
        "ciphertext": valid_body()["ciphertext"],
        "nonce": valid_body()["nonce"],
    }
    with session_factory() as session:
        after = session.scalar(select(func.clock_timestamp()))
    consumed_at = grant_consumed_at(session_factory, created["share_id"], "bgonzalez")
    assert before <= consumed_at <= after
    assert grant_consumed_at(session_factory, created["share_id"], "csaul") is None


def test_second_consume_is_410_already_consumed(client, auth_headers):
    token = tokens_of(create_via_api(client, auth_headers()))["bgonzalez"]
    consume(client, auth_headers("bgonzalez"), token)
    response = consume(client, auth_headers("bgonzalez"), token)
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "share_already_consumed"


@pytest.mark.parametrize("username,roles", [("csaul", ()), ("aperez", ()), ("flapinto", ("chismoso-admin",))])
def test_token_for_another_recipient_is_404_and_does_not_consume(client, auth_headers, session_factory, username, roles):
    created = create_via_api(client, auth_headers("aperez"))
    response = consume(client, auth_headers(username, roles), tokens_of(created)["bgonzalez"])
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "share_not_found"
    assert grant_consumed_at(session_factory, created["share_id"], "bgonzalez") is None


def test_unknown_and_malformed_tokens_are_indistinguishable_404s(client, auth_headers):
    unknown, _ = generate_access_token()
    bodies = set()
    for token in [unknown, "abc", unknown + "A", unknown[:-1] + "=", "+" * 43, ""]:
        response = consume(client, auth_headers("bgonzalez"), token)
        assert response.status_code == 404
        bodies.add(response.text)
    assert len(bodies) == 1


def test_missing_token_field_is_invalid_request(client, auth_headers):
    response = client.post(URL, json={}, headers=auth_headers("bgonzalez"))
    assert response.status_code == 422


def test_requires_authentication_and_does_not_consume(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    response = client.post(URL, json={"access_token": tokens_of(created)["bgonzalez"]})
    assert response.status_code == 401
    assert grant_consumed_at(session_factory, created["share_id"], "bgonzalez") is None


def test_expired_share_is_410_using_db_time(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    update_share(session_factory, created["share_id"], expires_at=func.clock_timestamp() - timedelta(milliseconds=1))
    response = consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"])
    assert response.status_code == 410
    assert response.json()["error"]["code"] == "share_expired"
    assert grant_consumed_at(session_factory, created["share_id"], "bgonzalez") is None


def test_share_just_before_expiry_is_consumable(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    update_share(session_factory, created["share_id"], expires_at=func.clock_timestamp() + timedelta(seconds=5))
    assert consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"]).status_code == 200


def test_revoked_share_is_410(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    update_share(session_factory, created["share_id"], revoked_at=func.now())
    response = consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"])
    assert (response.status_code, response.json()["error"]["code"]) == (410, "share_revoked")


def test_payload_deleted_marker_is_410(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    update_share(session_factory, created["share_id"], payload_deleted_at=func.now())
    response = consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"])
    assert (response.status_code, response.json()["error"]["code"]) == (410, "share_payload_deleted")


def test_missing_payload_row_is_410_and_metadata_survives(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    with session_factory() as session, session.begin():
        session.execute(delete(SharePayload).where(SharePayload.share_id == uuid.UUID(created["share_id"])))
    response = consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"])
    assert (response.status_code, response.json()["error"]["code"]) == (410, "share_payload_deleted")
    with session_factory() as session:
        assert session.get(Share, uuid.UUID(created["share_id"])) is not None
        assert session.scalar(select(func.count()).select_from(RecipientGrant)) == 2


def test_consumed_takes_precedence_over_expired(client, auth_headers, session_factory):
    created = create_via_api(client, auth_headers())
    token = tokens_of(created)["bgonzalez"]
    consume(client, auth_headers("bgonzalez"), token)
    update_share(session_factory, created["share_id"], expires_at=func.clock_timestamp() - timedelta(hours=1))
    assert consume(client, auth_headers("bgonzalez"), token).json()["error"]["code"] == "share_already_consumed"


def test_unknown_crypto_version_round_trips(client, auth_headers):
    created = create_via_api(client, auth_headers(), crypto_version=999)
    response = consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"])
    assert response.json()["crypto_version"] == 999


def test_shared_token_recipients_consume_independently(client, auth_headers):
    created = create_via_api(client, auth_headers(), shared_token=True)
    token = tokens_of(created)["bgonzalez"]
    assert token == tokens_of(created)["csaul"]
    assert consume(client, auth_headers("bgonzalez"), token).status_code == 200
    assert consume(client, auth_headers("csaul"), token).status_code == 200
    assert consume(client, auth_headers("bgonzalez"), token).status_code == 410
    assert consume(client, auth_headers("dlopez"), token).status_code == 404


def test_response_contains_only_decryption_fields(client, auth_headers):
    created = create_via_api(client, auth_headers())
    body = consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"]).json()
    assert set(body) == {"crypto_version", "ciphertext", "nonce"}
    assert tokens_of(created)["bgonzalez"] not in str(body)


def test_ciphertext_is_returned_exactly(client, auth_headers):
    ciphertext = encode_b64url(bytes(range(256)) * 4)
    created = create_via_api(client, auth_headers(), ciphertext=ciphertext)
    assert consume(client, auth_headers("bgonzalez"), tokens_of(created)["bgonzalez"]).json()["ciphertext"] == ciphertext
```

- [ ] **Step 2: Write failing concurrency and lock-order tests**

`backend/tests/test_consume_concurrency.py`:
```python
import threading
import time
from concurrent.futures import ThreadPoolExecutor

from sqlalchemy import delete, func, select, text, update

from app.consume import consume_grant
from app.errors import AppError
from app.models import RecipientGrant, Share, SharePayload
from app.shares import ValidatedShare, create_share
from app.tokens import hash_access_token


def seed_share(session_factory, recipients, shared_token=False):
    data = ValidatedShare(
        ciphertext=b"\x01" * 32,
        nonce=b"\x02" * 12,
        crypto_version=1,
        expires_in_minutes=60,
        recipients=recipients,
        shared_token=shared_token,
        label=None,
    )
    with session_factory() as session:
        created = create_share(session, creator="aperez", data=data)
    return created.share_id, dict(created.grants)


def attempt_consume(session_factory, token, recipient) -> str:
    with session_factory() as session:
        try:
            consume_grant(session, hash_access_token(token), recipient)
            return "ok"
        except AppError as exc:
            return exc.code


def test_same_grant_concurrent_consume_has_exactly_one_success(session_factory):
    _, tokens = seed_share(session_factory, ["bgonzalez"])
    workers = 8
    barrier = threading.Barrier(workers)

    def run(_):
        barrier.wait()
        return attempt_consume(session_factory, tokens["bgonzalez"], "bgonzalez")

    with ThreadPoolExecutor(workers) as pool:
        results = list(pool.map(run, range(workers)))

    assert results.count("ok") == 1
    assert results.count("share_already_consumed") == workers - 1
    with session_factory() as session:
        consumed = session.scalars(select(RecipientGrant.consumed_at)).all()
    assert len(consumed) == 1 and consumed[0] is not None


def test_shared_token_grants_for_different_recipients_both_succeed_concurrently(session_factory):
    _, tokens = seed_share(session_factory, ["bgonzalez", "csaul"], shared_token=True)
    barrier = threading.Barrier(2)

    def run(recipient):
        barrier.wait()
        return attempt_consume(session_factory, tokens[recipient], recipient)

    with ThreadPoolExecutor(2) as pool:
        assert list(pool.map(run, ["bgonzalez", "csaul"])) == ["ok", "ok"]


def test_consume_locks_share_before_grant(session_factory):
    share_id, tokens = seed_share(session_factory, ["bgonzalez"])
    with session_factory() as session:
        grant_id = session.scalar(select(RecipientGrant.id))

    holder = session_factory()
    holder.begin()
    holder.execute(select(Share).where(Share.id == share_id).with_for_update()).scalar_one()
    try:
        with ThreadPoolExecutor(1) as pool:
            future = pool.submit(attempt_consume, session_factory, tokens["bgonzalez"], "bgonzalez")
            time.sleep(0.5)
            assert not future.done(), "consume must wait for the Share lock"
            # If consume had locked the grant before the Share, NOWAIT would raise LockNotAvailable.
            with session_factory() as probe, probe.begin():
                probe.execute(
                    text("SELECT id FROM recipient_grants WHERE id = :id FOR UPDATE NOWAIT"), {"id": grant_id}
                )
            holder.rollback()
            assert future.result(timeout=10) == "ok"
    finally:
        holder.close()


def simulated_cleanup(session_factory, share_id) -> str:
    """Future cleanup worker shape (base spec §12.3): Share lock, then grants, then delete payload."""
    with session_factory() as session, session.begin():
        session.execute(select(Share).where(Share.id == share_id).with_for_update()).scalar_one()
        session.execute(select(RecipientGrant).where(RecipientGrant.share_id == share_id).with_for_update()).all()
        time.sleep(0.05)
        session.execute(delete(SharePayload).where(SharePayload.share_id == share_id))
        session.execute(update(Share).where(Share.id == share_id).values(payload_deleted_at=func.clock_timestamp()))
    return "cleaned"


def test_concurrent_consume_and_cleanup_do_not_deadlock(session_factory):
    seeded = [seed_share(session_factory, ["bgonzalez", "csaul"]) for _ in range(10)]
    jobs = []
    for share_id, tokens in seeded:
        jobs.append(lambda t=tokens: attempt_consume(session_factory, t["bgonzalez"], "bgonzalez"))
        jobs.append(lambda s=share_id: simulated_cleanup(session_factory, s))
        jobs.append(lambda t=tokens: attempt_consume(session_factory, t["csaul"], "csaul"))

    with ThreadPoolExecutor(12) as pool:
        futures = [pool.submit(job) for job in jobs]
        results = [f.result(timeout=30) for f in futures]  # a deadlock raises from psycopg here

    assert results.count("cleaned") == 10
    assert set(results) <= {"cleaned", "ok", "share_payload_deleted"}
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_consume.py tests/test_consume_concurrency.py -v`
Expected: FAIL (`ModuleNotFoundError: No module named 'app.consume'` / 404 responses).

- [ ] **Step 4: Implement (follow base spec §12.1–§12.2 exactly)**

`backend/app/consume.py`:
```python
from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StrictStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CurrentPrincipal
from app.deps import get_session
from app.encoding import encode_b64url
from app.errors import gone, share_not_found
from app.models import RecipientGrant, Share, SharePayload
from app.tokens import hash_access_token

router = APIRouter(prefix="/api/v1")


class ConsumeRequest(BaseModel):
    access_token: StrictStr


class ConsumeResponse(BaseModel):
    crypto_version: int
    ciphertext: str
    nonce: str


@dataclass(frozen=True)
class ConsumedPayload:
    crypto_version: int
    ciphertext: bytes
    nonce: bytes


def consume_grant(session: Session, token_hash: bytes, recipient_identity: str) -> ConsumedPayload:
    """Atomically claim one grant. Lock order is Share -> RecipientGrant (base spec §12)."""
    with session.begin():
        candidate = session.execute(
            select(RecipientGrant.id, RecipientGrant.share_id).where(
                RecipientGrant.access_token_hash == token_hash,
                RecipientGrant.recipient_identity == recipient_identity,
            )
        ).one_or_none()
        if candidate is None:
            raise share_not_found()

        share = session.execute(
            select(Share).where(Share.id == candidate.share_id).with_for_update()
        ).scalar_one()
        grant = session.execute(
            select(RecipientGrant).where(RecipientGrant.id == candidate.id).with_for_update()
        ).scalar_one()

        # Recheck under locks; also protects against future updates of these rows.
        if (
            grant.share_id != share.id
            or grant.access_token_hash != token_hash
            or grant.recipient_identity != recipient_identity
        ):
            raise share_not_found()

        # clock_timestamp(), not now(): judge expiry at actual claim time, after waiting for locks.
        db_now = session.scalar(select(func.clock_timestamp()))
        if grant.consumed_at is not None:
            raise gone("share_already_consumed")
        if share.expires_at <= db_now:
            raise gone("share_expired")
        if share.revoked_at is not None:
            raise gone("share_revoked")
        if share.payload_deleted_at is not None:
            raise gone("share_payload_deleted")

        payload = session.get(SharePayload, share.id)
        if payload is None:
            raise gone("share_payload_deleted")

        result = ConsumedPayload(
            crypto_version=payload.crypto_version, ciphertext=payload.ciphertext, nonce=payload.nonce
        )
        grant.consumed_at = db_now
    # Only reached after a successful commit.
    return result


@router.post("/access/consume", response_model=ConsumeResponse)
def post_consume(
    body: ConsumeRequest,
    principal: CurrentPrincipal,
    session: Annotated[Session, Depends(get_session)],
) -> ConsumeResponse:
    token_hash = hash_access_token(body.access_token)
    if token_hash is None:
        raise share_not_found()  # malformed tokens look exactly like unknown ones
    payload = consume_grant(session, token_hash, principal.username)
    return ConsumeResponse(
        crypto_version=payload.crypto_version,
        ciphertext=encode_b64url(payload.ciphertext),
        nonce=encode_b64url(payload.nonce),
    )
```

Modify `backend/app/main.py`: `from app import consume, shares` and add `app.include_router(consume.router)`.

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest -v`
Expected: PASS. Then run the concurrency file three times to catch flakiness: `for i in 1 2 3; do uv run pytest tests/test_consume_concurrency.py -q || break; done`. Expected: PASS every time.

- [ ] **Step 6: Commit**

```bash
git add backend/app/consume.py backend/app/main.py backend/tests/test_consume.py backend/tests/test_consume_concurrency.py
git commit -m "feat(backend): atomic one-time consume with Share-before-Grant locking

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Admin metadata listing and cross-cutting security tests

**Model:** sonnet

**Files:**
- Create: `backend/app/admin.py`
- Modify: `backend/app/main.py` (include router)
- Test: `backend/tests/test_admin.py`, `backend/tests/test_security.py`

**Interfaces:**
- Consumes: `AdminPrincipal`, `get_session`, `get_settings`, `invalid_request`, `to_utc`, models; `create_via_api`.
- Produces: `app.admin.router` with `GET /api/v1/admin/shares?page=&page_size=` returning `{"items": [...], "page", "page_size", "total"}` as in base spec §14.

- [ ] **Step 1: Write failing tests**

`backend/tests/test_admin.py`:
```python
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import update

from app.models import Share
from tests.helpers import create_via_api

URL = "/api/v1/admin/shares"
ADMIN = ("flapinto", ("chismoso-admin",))


def admin_get(client, auth_headers, **params):
    return client.get(URL, params=params, headers=auth_headers(*ADMIN))


def test_requires_authentication(client):
    assert client.get(URL).status_code == 401


def test_non_admin_is_forbidden(client, auth_headers):
    response = client.get(URL, headers=auth_headers("dlopez"))
    assert response.status_code == 403
    assert response.json()["error"]["code"] == "admin_access_required"


def test_lists_metadata_only(client, auth_headers):
    created = create_via_api(client, auth_headers("aperez"), label="Prod DB")
    token = created["grants"][0]["access_token"]
    client.post("/api/v1/access/consume", json={"access_token": token}, headers=auth_headers("bgonzalez"))

    response = admin_get(client, auth_headers)

    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    body = response.json()
    assert (body["page"], body["page_size"], body["total"]) == (1, 50, 1)
    (item,) = body["items"]
    assert set(item) == {
        "id", "creator_identity", "label", "created_at", "expires_at", "revoked_at", "payload_deleted_at", "grants",
    }
    assert item["id"] == created["share_id"]
    assert item["creator_identity"] == "aperez"
    assert item["label"] == "Prod DB"
    assert item["created_at"].endswith("Z")
    grants = {g["recipient_identity"]: g for g in item["grants"]}
    assert set(grants["bgonzalez"]) == {"recipient_identity", "consumed_at"}
    assert grants["bgonzalez"]["consumed_at"] is not None
    assert grants["csaul"]["consumed_at"] is None
    for forbidden in ("ciphertext", "nonce", "access_token", "hash", token):
        assert forbidden not in response.text


def test_pagination_newest_first(client, auth_headers):
    ids = [create_via_api(client, auth_headers(), label=f"share-{i}")["share_id"] for i in range(3)]
    first = admin_get(client, auth_headers, page=1, page_size=2).json()
    second = admin_get(client, auth_headers, page=2, page_size=2).json()
    beyond = admin_get(client, auth_headers, page=3, page_size=2).json()
    assert first["total"] == 3
    assert [i["id"] for i in first["items"]] + [i["id"] for i in second["items"]] == list(reversed(ids))
    assert beyond["items"] == [] and beyond["total"] == 3


def test_equal_created_at_is_ordered_by_id_desc(client, auth_headers, session_factory):
    ids = [create_via_api(client, auth_headers())["share_id"] for _ in range(3)]
    same = datetime(2026, 1, 1, tzinfo=UTC)
    with session_factory() as session, session.begin():
        session.execute(update(Share).values(created_at=same))
    listed = [i["id"] for i in admin_get(client, auth_headers).json()["items"]]
    assert listed == sorted(ids, key=uuid.UUID, reverse=True)


@pytest.mark.parametrize(
    "params",
    [
        {"page_size": 101},
        {"page_size": 0},
        {"page": 0},
        {"page": -1},
        {"page": "abc"},
        {"page": 10**12},
    ],
)
def test_invalid_pagination_is_422_not_500(client, auth_headers, params):
    response = admin_get(client, auth_headers, **params)
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_request"


def test_max_page_size_is_allowed(client, auth_headers):
    assert admin_get(client, auth_headers, page_size=100).status_code == 200
```

`backend/tests/test_security.py`:
```python
import hashlib
import logging
import secrets

from app.encoding import decode_b64url, encode_b64url
from tests.helpers import valid_body


def test_no_secret_material_in_logs(client, auth_headers, caplog):
    caplog.set_level(logging.DEBUG)  # root at DEBUG: proves SQL params are not logged either
    sender = auth_headers("aperez")
    recipient = auth_headers("bgonzalez")
    body = valid_body(
        ciphertext=encode_b64url(secrets.token_bytes(64)),
        nonce=encode_b64url(secrets.token_bytes(12)),
    )

    created = client.post("/api/v1/shares", json=body, headers=sender).json()
    token = created["grants"][0]["access_token"]
    client.post("/api/v1/access/consume", json={"access_token": token}, headers=recipient)
    client.post("/api/v1/access/consume", json={"access_token": token}, headers=recipient)  # 410
    client.post("/api/v1/access/consume", json={"access_token": "x" * 43}, headers=recipient)  # 404
    client.post("/api/v1/shares", json={**body, "recipients": ["bad@example.com"]}, headers=sender)  # 422

    token_hash = hashlib.sha256(decode_b64url(token, max_bytes=32)).hexdigest()
    forbidden = {
        "raw token": token,
        "ciphertext": body["ciphertext"],
        "nonce": body["nonce"],
        "bearer": sender["Authorization"].split(" ", 1)[1],
        "recipient bearer": recipient["Authorization"].split(" ", 1)[1],
        "token hash": token_hash,
        "authorization header": "Bearer ",
    }
    for name, value in forbidden.items():
        assert value not in caplog.text, f"{name} leaked into logs"
    assert "route=/api/v1/access/consume" in caplog.text
    assert "route=/api/v1/shares" in caplog.text


def test_sensitive_responses_are_no_store(client, auth_headers):
    created = client.post("/api/v1/shares", json=valid_body(), headers=auth_headers())
    consumed = client.post(
        "/api/v1/access/consume",
        json={"access_token": created.json()["grants"][0]["access_token"]},
        headers=auth_headers("bgonzalez"),
    )
    error = client.post("/api/v1/access/consume", json={"access_token": "nope"}, headers=auth_headers("bgonzalez"))
    for response in (created, consumed, error):
        assert response.headers["cache-control"] == "no-store"
        assert response.headers["referrer-policy"] == "no-referrer"
        assert response.headers["x-content-type-options"] == "nosniff"


def test_no_get_route_consumes_or_reveals(client, auth_headers):
    created = client.post("/api/v1/shares", json=valid_body(), headers=auth_headers()).json()
    token = created["grants"][0]["access_token"]
    for path in (
        f"/api/v1/shares/{created['share_id']}",
        f"/api/v1/access/consume?access_token={token}",
        f"/api/v1/grants/{created['share_id']}",
    ):
        assert client.get(path, headers=auth_headers("bgonzalez")).status_code in (404, 405)
    ok = client.post("/api/v1/access/consume", json={"access_token": token}, headers=auth_headers("bgonzalez"))
    assert ok.status_code == 200  # still unconsumed after all the GETs
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_admin.py tests/test_security.py -v`
Expected: admin tests FAIL (404, no route). Security tests may already pass. They are regression guards.

- [ ] **Step 3: Implement**

`backend/app/admin.py`:
```python
import uuid
from collections import defaultdict
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AdminPrincipal
from app.config import Settings
from app.deps import get_session, get_settings
from app.errors import invalid_request
from app.models import RecipientGrant, Share
from app.timeutil import to_utc

MAX_PAGE = 1_000_000

router = APIRouter(prefix="/api/v1/admin")


class GrantMeta(BaseModel):
    recipient_identity: str
    consumed_at: datetime | None


class ShareMeta(BaseModel):
    id: uuid.UUID
    creator_identity: str
    label: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    payload_deleted_at: datetime | None
    grants: list[GrantMeta]


class AdminSharesPage(BaseModel):
    items: list[ShareMeta]
    page: int
    page_size: int
    total: int


def _utc_or_none(value: datetime | None) -> datetime | None:
    return to_utc(value) if value is not None else None


@router.get("/shares", response_model=AdminSharesPage)
def list_shares(
    principal: AdminPrincipal,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    page: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 1,
    page_size: Annotated[int, Query(ge=1)] = 50,
) -> AdminSharesPage:
    if page_size > settings.max_admin_page_size:
        raise invalid_request("page_size is too large.")
    with session.begin():
        total = session.scalar(select(func.count()).select_from(Share))
        shares = session.scalars(
            select(Share)
            .order_by(Share.created_at.desc(), Share.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        grants_by_share: dict[uuid.UUID, list[GrantMeta]] = defaultdict(list)
        if shares:
            rows = session.execute(
                select(RecipientGrant.share_id, RecipientGrant.recipient_identity, RecipientGrant.consumed_at)
                .where(RecipientGrant.share_id.in_([s.id for s in shares]))
                .order_by(RecipientGrant.recipient_identity)
            ).all()
            for row in rows:
                grants_by_share[row.share_id].append(
                    GrantMeta(recipient_identity=row.recipient_identity, consumed_at=_utc_or_none(row.consumed_at))
                )
    items = [
        ShareMeta(
            id=s.id,
            creator_identity=s.creator_identity,
            label=s.label,
            created_at=to_utc(s.created_at),
            expires_at=to_utc(s.expires_at),
            revoked_at=_utc_or_none(s.revoked_at),
            payload_deleted_at=_utc_or_none(s.payload_deleted_at),
            grants=grants_by_share[s.id],
        )
        for s in shares
    ]
    return AdminSharesPage(items=items, page=page, page_size=page_size, total=total)
```

Modify `backend/app/main.py`: `from app import admin, consume, shares` and add `app.include_router(admin.router)`.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest -v`
Expected: PASS (whole backend suite).

- [ ] **Step 5: Commit**

```bash
git add backend/app/admin.py backend/app/main.py backend/tests/test_admin.py backend/tests/test_security.py
git commit -m "feat(backend): paginated metadata-only admin listing and security regression tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone 2 — Dev stack and frontend foundations

### Task 8: Dev stack — backend image, frontend scaffold, Caddy, Compose, Keycloak reachability

**Model:** opus

**Files:**
- Create: `backend/Dockerfile`, `backend/.dockerignore`, `infra/caddy/Caddyfile.dev`
- Create (scaffold): `frontend/` via `create-vite` (`react-ts` template), then edit `frontend/vite.config.ts`, `frontend/index.html`, `frontend/src/App.tsx`, `frontend/src/main.tsx`, `frontend/src/index.css`, `frontend/package.json`
- Replace: `compose.yaml` (full dev stack)

**Interfaces:**
- Consumes: `app.main:create_app` (factory), Alembic config, `.env`.
- Produces: a running dev stack at `http://app.localhost:3000`. `/api/*` goes to FastAPI (path preserved) and everything else to Vite with HMR. The frontend container receives `VITE_MAX_PLAINTEXT_BYTES`, `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID`. Frontend npm scripts: `dev`, `build`, `lint`, `test` (`vitest run`), `e2e` (`playwright test --project=dev`), `e2e:smoke` (`playwright test --project=prod-smoke`). `vite.config.ts` carries the Vitest config: default environment `node`, setup `src/test/setup.ts`, include `src/**/*.test.{ts,tsx}`.

- [ ] **Step 1: Backend image**

`backend/.dockerignore`:
```
.venv
__pycache__
.pytest_cache
*.pyc
```

`backend/Dockerfile`:
```dockerfile
FROM python:3.14-slim
COPY --from=ghcr.io/astral-sh/uv:0.12.5 /uv /bin/uv

ENV UV_PROJECT_ENVIRONMENT=/opt/venv \
    UV_PYTHON_DOWNLOADS=never \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PATH="/opt/venv/bin:$PATH" \
    PYTHONUNBUFFERED=1

WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
RUN uv sync --frozen --no-dev
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "alembic upgrade head && uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000 --no-access-log"]
```

- [ ] **Step 2: Scaffold the frontend**

Run (from `tp_final/`):
```bash
npm create vite@latest frontend -- --template react-ts --no-interactive
cd frontend
npm install
npm install react-router oidc-client-ts
npm install -D vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom @playwright/test
```
If `create-vite` does not know `--no-interactive`, run it without that flag and decline "install and start now". Then delete the template demo assets: `rm -f src/App.css src/assets/react.svg public/vite.svg` (remove now-empty dirs).

Replace `frontend/vite.config.ts`:
```ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['app.localhost'],
    // The browser reaches Vite through the proxy on :3000.
    hmr: { clientPort: 3000 },
  },
  test: {
    environment: 'node',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}'],
  },
})
```

Create `frontend/src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
```

Replace `frontend/index.html`:
```html
<!doctype html>
<html lang="es">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="referrer" content="no-referrer" />
    <title>Chismoso</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

Replace `frontend/src/App.tsx` (temporary shell; Task 12 replaces it):
```tsx
export function App() {
  return <h1>Chismoso</h1>
}
```

Replace `frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
```

Replace `frontend/src/index.css`:
```css
:root {
  font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  line-height: 1.5;
  color: #1f2328;
  background: #ffffff;
}
body { margin: 0; }
main { max-width: 760px; margin: 0 auto; padding: 1.5rem 1rem 3rem; }
.app-header { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; border-bottom: 1px solid #d0d7de; }
.app-header nav { display: flex; gap: 1rem; }
.brand { font-weight: 700; text-decoration: none; color: inherit; }
label { display: block; margin-top: 1rem; font-weight: 600; }
label.checkbox { font-weight: 400; }
input[type='text'], input[type='number'], select, textarea { width: 100%; box-sizing: border-box; padding: 0.5rem; font: inherit; }
textarea { font-family: ui-monospace, monospace; }
button { margin-top: 1rem; padding: 0.5rem 1rem; font: inherit; cursor: pointer; }
.hint { color: #59636e; font-size: 0.9rem; margin: 0.25rem 0 0; }
.error { color: #cf222e; }
.notice { border: 1px solid #d0d7de; border-radius: 6px; padding: 0.75rem 1rem; margin: 1rem 0; }
.links { list-style: none; padding: 0; }
.links li { border: 1px solid #d0d7de; border-radius: 6px; padding: 0.75rem; margin-bottom: 0.75rem; }
.links code { display: block; word-break: break-all; margin: 0.5rem 0; }
table { width: 100%; border-collapse: collapse; font-size: 0.9rem; }
th, td { text-align: left; padding: 0.4rem; border-bottom: 1px solid #d0d7de; vertical-align: top; }
```

In `frontend/package.json`, set `"scripts"` to (keep whatever `lint` command the template generated):
```json
{
  "dev": "vite",
  "build": "tsc -b && vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "test": "vitest run",
  "e2e": "playwright test --project=dev",
  "e2e:smoke": "playwright test --project=prod-smoke"
}
```
In `frontend/tsconfig.app.json` `compilerOptions`, add `"resolveJsonModule": true` (needed in Task 9).

Run: `npm run build && npm run lint`
Expected: both succeed.

- [ ] **Step 3: Caddy dev config**

`infra/caddy/Caddyfile.dev`:
```caddyfile
{
	auto_https off
	admin off
}

# Plain HTTP on purpose: http://app.localhost:3000 is a secure context without any CA.
http://:3000 {
	header {
		defer
		# Dev-only relaxations: Vite's inline React-refresh preamble and injected styles, HMR WebSocket.
		Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://app.localhost:3000 {$OIDC_ORIGIN}; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
		Referrer-Policy "no-referrer"
		X-Content-Type-Options "nosniff"
		Cache-Control "no-store"
	}

	handle /api/* {
		request_body {
			max_size 256KB
		}
		# No path stripping: FastAPI serves /api/v1/... as-is.
		reverse_proxy backend:8000
	}

	handle {
		reverse_proxy frontend:5173
	}
}
```

- [ ] **Step 4: Full dev Compose file**

Replace `compose.yaml`:
```yaml
name: chismoso

services:
  db:
    image: postgres:18-alpine
    env_file: .env
    volumes:
      - db-data:/var/lib/postgresql
      - ./infra/postgres/init:/docker-entrypoint-initdb.d:ro
    ports:
      - "127.0.0.1:5433:5432"
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30

  backend:
    build: ./backend
    env_file: .env
    command: >
      sh -c "alembic upgrade head &&
             uvicorn app.main:create_app --factory --host 0.0.0.0 --port 8000
             --no-access-log --reload --reload-dir app"
    volumes:
      - ./backend:/app
    depends_on:
      db:
        condition: service_healthy
    networks: [default, idp]

  frontend:
    image: node:22-alpine
    working_dir: /app
    environment:
      VITE_MAX_PLAINTEXT_BYTES: ${MAX_PLAINTEXT_BYTES}
      VITE_OIDC_ISSUER: ${OIDC_ISSUER}
      VITE_OIDC_CLIENT_ID: ${OIDC_CLIENT_ID}
    command: sh -c "npm ci && npm run dev"
    volumes:
      - ./frontend:/app
      # Container-native node_modules (Alpine/musl) instead of the host's.
      - frontend-node-modules:/app/node_modules

  proxy:
    image: caddy:2-alpine
    environment:
      OIDC_ORIGIN: ${OIDC_ORIGIN}
    volumes:
      - ./infra/caddy/Caddyfile.dev:/etc/caddy/Caddyfile:ro
    ports:
      - "127.0.0.1:3000:3000"
    depends_on: [backend, frontend]

networks:
  # The separately operated Keycloak stack's network; used only to fetch JWKS (OIDC_JWKS_URL).
  idp:
    external: true
    name: ${IDP_DOCKER_NETWORK:-chismoso-idp_default}

volumes:
  db-data:
  frontend-node-modules:
```

- [ ] **Step 5: Bring it up and verify each contract**

Run (from `tp_final/`): `docker compose up -d --build && docker compose ps`
Expected: `db`, `backend`, `frontend`, `proxy` running. Wait about 30 s on first start for `npm ci`, then check `docker compose logs frontend | tail` for "ready".

Verify, in order:
1. App through the proxy: `curl -s -D - -o /dev/null http://app.localhost:3000/`. Expected: `200`, plus `Content-Security-Policy` containing `frame-ancestors 'none'`, and `Cache-Control: no-store`.
2. `/api` routed without stripping: `curl -s http://app.localhost:3000/api/v1/admin/shares`. Expected: `{"error":{"code":"authentication_required",...}}`.
3. Body limit: `head -c 300000 /dev/zero | tr '\0' 'a' | curl -s -o /dev/null -w '%{http_code}\n' -X POST -H 'content-type: application/json' --data-binary @- http://app.localhost:3000/api/v1/shares`. Expected: `413`.
4. Vite client served (HMR plumbing): `curl -s -o /dev/null -w '%{http_code}\n' http://app.localhost:3000/@vite/client`. Expected: `200`. The WebSocket itself is checked by Playwright in Task 16.
5. Backend reaches Keycloak JWKS via the IdP network: `docker compose exec backend python -c "import jwt; from app.config import Settings; s=Settings(); print(s.jwks_url, len(jwt.PyJWKClient(s.jwks_url).get_jwk_set().keys))"`. Expected: `http://keycloak:8080/realms/chismoso/protocol/openid-connect/certs` followed by a number ≥ 1.
6. Issuer is unchanged: `docker compose exec backend python -c "from app.config import Settings; print(Settings().oidc_issuer)"`. Expected: `http://idp.localhost:8080/realms/chismoso`.
7. Migrations applied: `docker compose exec backend alembic current`. Expected: `0001 (head)`.
8. Backend tests still pass on host: `cd backend && uv run pytest -q`. Expected: PASS.

If step 5 fails, run `docker network ls | grep chismoso-idp`. **Do not** change Keycloak. If the network name differs, set `IDP_DOCKER_NETWORK` in `.env` and `.env.example` and report it.

- [ ] **Step 6: Commit**

```bash
git add backend/Dockerfile backend/.dockerignore infra/caddy/Caddyfile.dev compose.yaml frontend/package.json frontend/package-lock.json frontend/index.html frontend/vite.config.ts frontend/tsconfig.json frontend/tsconfig.app.json frontend/tsconfig.node.json frontend/eslint.config.js frontend/.gitignore frontend/src frontend/README.md
git commit -m "feat(infra): dev stack with Caddy same-origin proxy, Vite HMR and Keycloak JWKS access

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Adjust the `frontend/...` list to the files the scaffold actually created. Run `git status` and stage only scaffold and task files, never `node_modules`. Delete the template's `frontend/README.md` instead of committing it if it is just Vite boilerplate.)

---

### Task 9: Crypto protocol v1 — cross-client vectors, base64url and WebCrypto implementation

**Model:** opus

**Files:**
- Create: `backend/scripts/gen_crypto_vectors.py`, `frontend/src/crypto/__fixtures__/v1-vectors.json` (generated)
- Create: `frontend/src/crypto/base64url.ts`, `frontend/src/crypto/v1.ts`
- Test: `backend/tests/test_crypto_vectors.py`, `frontend/src/crypto/base64url.test.ts`, `frontend/src/crypto/v1.test.ts`

**Interfaces:**
- Produces:
  - `crypto/base64url.ts`: `class Base64UrlError extends Error`, `encodeBase64Url(bytes: Uint8Array): string`, `decodeBase64Url(value: string): Uint8Array<ArrayBuffer>` (throws `Base64UrlError` on padding, bad alphabet, impossible length or non-canonical input).
  - `crypto/v1.ts`: `CRYPTO_VERSION = 1`, `AAD: Uint8Array`, `interface EncryptedV1 { cek: string; nonce: string; ciphertext: string }` (all base64url), `encryptV1(plaintext: string): Promise<EncryptedV1>` (fresh random CEK and nonce), `encryptV1With(plaintext, cek: Uint8Array<ArrayBuffer>, nonce: Uint8Array<ArrayBuffer>): Promise<EncryptedV1>`, `decryptV1(input: EncryptedV1): Promise<string>` (throws `DecryptionError`), `class DecryptionError extends Error`.

- [ ] **Step 1: Vector generator and Python verification test (failing)**

`backend/scripts/gen_crypto_vectors.py`:
```python
"""Generate cross-client known-answer vectors for Chismoso crypto protocol v1.

Writes frontend/src/crypto/__fixtures__/v1-vectors.json. Run from backend/:
    uv run python -m scripts.gen_crypto_vectors
"""

import json
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.encoding import encode_b64url

AAD = b"secret-handoff:v1"
OUTPUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "crypto" / "__fixtures__" / "v1-vectors.json"

CASES = [
    ("ascii", "correct horse battery staple", bytes(range(32)), bytes(range(100, 112))),
    ("utf8-multibyte", "contraseña: ñandú 🔐 — «secreto»", bytes([0xA5] * 32), bytes([0x5A] * 12)),
    ("multiline", "line one\nline two\r\n\ttabbed", bytes(range(255, 223, -1)), bytes(range(12))),
    ("empty", "", bytes([0x11] * 32), bytes(12)),
]


def build_vectors() -> list[dict[str, str]]:
    vectors = []
    for name, plaintext, cek, nonce in CASES:
        ciphertext = AESGCM(cek).encrypt(nonce, plaintext.encode("utf-8"), AAD)  # includes 16-byte tag
        vectors.append(
            {
                "name": name,
                "plaintext": plaintext,
                "cek": encode_b64url(cek),
                "nonce": encode_b64url(nonce),
                "ciphertext": encode_b64url(ciphertext),
            }
        )
    return vectors


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = {"aad": AAD.decode("ascii"), "vectors": build_vectors()}
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
```

`backend/tests/test_crypto_vectors.py`:
```python
import json

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.encoding import decode_b64url
from scripts.gen_crypto_vectors import AAD, OUTPUT, build_vectors


def load():
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


def test_committed_vectors_match_generator():
    document = load()
    assert document["aad"] == "secret-handoff:v1"
    assert document["vectors"] == build_vectors()


def test_vectors_decrypt_with_independent_python_implementation():
    for vector in load()["vectors"]:
        cek = decode_b64url(vector["cek"], max_bytes=32)
        nonce = decode_b64url(vector["nonce"], max_bytes=12)
        ciphertext = decode_b64url(vector["ciphertext"], max_bytes=100_000)
        assert len(cek) == 32 and len(nonce) == 12
        assert len(ciphertext) == len(vector["plaintext"].encode("utf-8")) + 16
        assert AESGCM(cek).decrypt(nonce, ciphertext, AAD).decode("utf-8") == vector["plaintext"]
```

Run (from `backend/`): `uv run pytest tests/test_crypto_vectors.py -v`
Expected: FAIL (`FileNotFoundError` for the JSON file).

- [ ] **Step 2: Generate vectors and pass the Python test**

Run: `uv run python -m scripts.gen_crypto_vectors && uv run pytest tests/test_crypto_vectors.py -v`
Expected: JSON written to `frontend/src/crypto/__fixtures__/v1-vectors.json`; tests PASS.

- [ ] **Step 3: Failing TypeScript tests**

`frontend/src/crypto/base64url.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { Base64UrlError, decodeBase64Url, encodeBase64Url } from './base64url'

describe('base64url', () => {
  it('round-trips without padding using the URL-safe alphabet', () => {
    const bytes = new Uint8Array([0xfb, 0xff, 0x00, 0x10])
    const encoded = encodeBase64Url(bytes)
    expect(encoded).toBe('-_8AEA')
    expect(Array.from(decodeBase64Url(encoded))).toEqual(Array.from(bytes))
  })

  it('encodes 32 bytes as 43 characters', () => {
    expect(encodeBase64Url(new Uint8Array(32))).toHaveLength(43)
  })

  it('decodes the empty string', () => {
    expect(decodeBase64Url('')).toHaveLength(0)
  })

  it.each(['AAAA=', 'AA+A', 'AA/A', 'A', 'AB', 'AA AA', 'ÁAAA', 'AAAA\n'])('rejects %j', (value) => {
    expect(() => decodeBase64Url(value)).toThrow(Base64UrlError)
  })
})
```

`frontend/src/crypto/v1.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import vectors from './__fixtures__/v1-vectors.json'
import { decodeBase64Url, encodeBase64Url } from './base64url'
import { AAD, CRYPTO_VERSION, DecryptionError, decryptV1, encryptV1, encryptV1With } from './v1'

describe('crypto v1 known vectors (generated by Python cryptography)', () => {
  it('uses the exact AAD', () => {
    expect(new TextDecoder().decode(AAD)).toBe(vectors.aad)
    expect(CRYPTO_VERSION).toBe(1)
  })

  for (const vector of vectors.vectors) {
    it(`encrypts "${vector.name}" to the known ciphertext`, async () => {
      const out = await encryptV1With(vector.plaintext, decodeBase64Url(vector.cek), decodeBase64Url(vector.nonce))
      expect(out).toEqual({ cek: vector.cek, nonce: vector.nonce, ciphertext: vector.ciphertext })
    })

    it(`decrypts "${vector.name}"`, async () => {
      await expect(decryptV1(vector)).resolves.toBe(vector.plaintext)
    })
  }
})

describe('crypto v1 encrypt/decrypt', () => {
  it('generates a fresh 32-byte CEK and 12-byte nonce each time', async () => {
    const a = await encryptV1('secret')
    const b = await encryptV1('secret')
    expect(decodeBase64Url(a.cek)).toHaveLength(32)
    expect(decodeBase64Url(a.nonce)).toHaveLength(12)
    expect(a.cek).not.toBe(b.cek)
    expect(a.nonce).not.toBe(b.nonce)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('appends the 16-byte tag to the ciphertext', async () => {
    const out = await encryptV1('ñ')
    expect(decodeBase64Url(out.ciphertext)).toHaveLength(2 + 16)
  })

  it('round-trips unicode', async () => {
    const plaintext = 'clave: ñandú 🔐\nline 2'
    await expect(decryptV1(await encryptV1(plaintext))).resolves.toBe(plaintext)
  })

  it('fails with DecryptionError for a wrong key', async () => {
    const out = await encryptV1('secret')
    const other = await encryptV1('other')
    await expect(decryptV1({ ...out, cek: other.cek })).rejects.toBeInstanceOf(DecryptionError)
  })

  it('fails with DecryptionError for tampered ciphertext', async () => {
    const out = await encryptV1('secret')
    const bytes = decodeBase64Url(out.ciphertext)
    bytes[0] ^= 1
    await expect(decryptV1({ ...out, ciphertext: encodeBase64Url(bytes) })).rejects.toBeInstanceOf(DecryptionError)
  })

  it.each([
    ['malformed cek', { cek: 'not base64url!' }],
    ['short cek', { cek: 'AAAA' }],
    ['short nonce', { nonce: 'AAAA' }],
    ['short ciphertext', { ciphertext: 'AAAA' }],
  ])('fails with DecryptionError for %s', async (_name, override) => {
    const out = await encryptV1('secret')
    await expect(decryptV1({ ...out, ...override })).rejects.toBeInstanceOf(DecryptionError)
  })
})
```

Run (from `frontend/`): `npx vitest run src/crypto`
Expected: FAIL (modules not found).

- [ ] **Step 4: Implement**

`frontend/src/crypto/base64url.ts`:
```ts
const ALPHABET = /^[A-Za-z0-9_-]*$/

export class Base64UrlError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'Base64UrlError'
  }
}

export function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Strict unpadded base64url (RFC 4648 §5) decoding; rejects non-canonical input. */
export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  if (!ALPHABET.test(value) || value.length % 4 === 1) {
    throw new Base64UrlError('invalid base64url')
  }
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4)
  const binary = atob(padded)
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0))
  if (encodeBase64Url(bytes) !== value) throw new Base64UrlError('non-canonical base64url')
  return bytes
}
```

`frontend/src/crypto/v1.ts`:
```ts
import { decodeBase64Url, encodeBase64Url } from './base64url'

/** Chismoso client crypto protocol v1 (base spec §6). The server never interprets it. */
export const CRYPTO_VERSION = 1
export const AAD = new TextEncoder().encode('secret-handoff:v1')

const CEK_BYTES = 32
const NONCE_BYTES = 12
const TAG_BITS = 128

export interface EncryptedV1 {
  cek: string
  nonce: string
  ciphertext: string
}

export class DecryptionError extends Error {
  constructor() {
    super('decryption failed')
    this.name = 'DecryptionError'
  }
}

export async function encryptV1(plaintext: string): Promise<EncryptedV1> {
  const cek = crypto.getRandomValues(new Uint8Array(CEK_BYTES))
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES))
  return encryptV1With(plaintext, cek, nonce)
}

/** Deterministic variant for known-answer tests; production code uses encryptV1. */
export async function encryptV1With(
  plaintext: string,
  cek: Uint8Array<ArrayBuffer>,
  nonce: Uint8Array<ArrayBuffer>,
): Promise<EncryptedV1> {
  if (cek.length !== CEK_BYTES || nonce.length !== NONCE_BYTES) {
    throw new Error('invalid key or nonce length')
  }
  const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt'])
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce, additionalData: AAD, tagLength: TAG_BITS },
    key,
    new TextEncoder().encode(plaintext),
  )
  return {
    cek: encodeBase64Url(cek),
    nonce: encodeBase64Url(nonce),
    ciphertext: encodeBase64Url(new Uint8Array(ciphertext)),
  }
}

export async function decryptV1(input: EncryptedV1): Promise<string> {
  let cek: Uint8Array<ArrayBuffer>
  let nonce: Uint8Array<ArrayBuffer>
  let ciphertext: Uint8Array<ArrayBuffer>
  try {
    cek = decodeBase64Url(input.cek)
    nonce = decodeBase64Url(input.nonce)
    ciphertext = decodeBase64Url(input.ciphertext)
  } catch {
    throw new DecryptionError()
  }
  if (cek.length !== CEK_BYTES || nonce.length !== NONCE_BYTES || ciphertext.length < TAG_BITS / 8) {
    throw new DecryptionError()
  }
  try {
    const key = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['decrypt'])
    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: nonce, additionalData: AAD, tagLength: TAG_BITS },
      key,
      ciphertext,
    )
    return new TextDecoder('utf-8', { fatal: true }).decode(plaintext)
  } catch {
    throw new DecryptionError()
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run (from `frontend/`): `npm test && npm run build && npm run lint`
Expected: PASS. Fix TypeScript `BufferSource`/`Uint8Array<ArrayBuffer>` typing errors with explicit types, never `any`.
Run (from `backend/`): `uv run pytest -q`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/gen_crypto_vectors.py backend/tests/test_crypto_vectors.py frontend/src/crypto
git commit -m "feat(crypto): AES-256-GCM protocol v1 with cross-client known-answer vectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: Share link build/parse

**Model:** sonnet

**Files:**
- Create: `frontend/src/link.ts`
- Test: `frontend/src/link.test.ts`

**Interfaces:**
- Consumes: `decodeBase64Url`, `encodeBase64Url`.
- Produces: `interface ShareLink { version: 1; token: string; cek: string }`, `buildShareLink(origin: string, token: string, cek: string): string` (returns `${origin}/s#v=1&t=${token}&k=${cek}`), `parseShareFragment(hash: string): ShareLink | null`. The parser is strict: exactly the keys `v`, `t`, `k`, each once; `v === '1'`; `t` and `k` each 43 characters of canonical base64url that decode to 32 bytes.

- [ ] **Step 1: Write failing tests**

`frontend/src/link.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { encodeBase64Url } from './crypto/base64url'
import { buildShareLink, parseShareFragment } from './link'

const TOKEN = encodeBase64Url(new Uint8Array(32).fill(7))
const CEK = encodeBase64Url(new Uint8Array(32).fill(9))
const VALID = `#v=1&t=${TOKEN}&k=${CEK}`

describe('buildShareLink', () => {
  it('puts token and key only in the fragment', () => {
    const link = buildShareLink('http://app.localhost:3000', TOKEN, CEK)
    expect(link).toBe(`http://app.localhost:3000/s#v=1&t=${TOKEN}&k=${CEK}`)
    expect(new URL(link).pathname).toBe('/s')
    expect(new URL(link).search).toBe('')
  })

  it('round-trips through the parser', () => {
    const link = buildShareLink('http://app.localhost:3000', TOKEN, CEK)
    expect(parseShareFragment(new URL(link).hash)).toEqual({ version: 1, token: TOKEN, cek: CEK })
  })
})

describe('parseShareFragment', () => {
  it('accepts a valid fragment with or without the leading #', () => {
    expect(parseShareFragment(VALID)).toEqual({ version: 1, token: TOKEN, cek: CEK })
    expect(parseShareFragment(VALID.slice(1))).toEqual({ version: 1, token: TOKEN, cek: CEK })
  })

  it('accepts parameters in any order', () => {
    expect(parseShareFragment(`#k=${CEK}&v=1&t=${TOKEN}`)).not.toBeNull()
  })

  it.each([
    ['empty', ''],
    ['only hash', '#'],
    ['missing version', `#t=${TOKEN}&k=${CEK}`],
    ['missing token', `#v=1&k=${CEK}`],
    ['missing key', `#v=1&t=${TOKEN}`],
    ['unsupported version', `#v=2&t=${TOKEN}&k=${CEK}`],
    ['padded version', `#v=01&t=${TOKEN}&k=${CEK}`],
    ['short token', `#v=1&t=${TOKEN.slice(1)}&k=${CEK}`],
    ['long token', `#v=1&t=${TOKEN}A&k=${CEK}`],
    ['padded key', `#v=1&t=${TOKEN}&k=${CEK}=`],
    ['standard alphabet', `#v=1&t=${TOKEN.replace(/.$/, '+')}&k=${CEK}`],
    ['non-canonical key', `#v=1&t=${TOKEN}&k=${CEK.slice(0, 42)}B`],
    ['trailing period from chat apps', `${VALID}.`],
    ['trailing parenthesis', `${VALID})`],
    ['duplicate key', `${VALID}&k=${CEK}`],
    ['extra parameter', `${VALID}&x=1`],
    ['missing value separator', `#v=1&t${TOKEN}&k=${CEK}`],
    ['whitespace', `#v=1&t=${TOKEN} &k=${CEK}`],
  ])('rejects %s', (_name, hash) => {
    expect(parseShareFragment(hash)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/link.test.ts`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement**

`frontend/src/link.ts`:
```ts
import { decodeBase64Url } from './crypto/base64url'

export interface ShareLink {
  version: 1
  token: string
  cek: string
}

const KEY_OR_TOKEN = /^[A-Za-z0-9_-]{43}$/

/** Token and CEK live only in the fragment, which browsers never send to servers. */
export function buildShareLink(origin: string, token: string, cek: string): string {
  return `${origin}/s#v=1&t=${token}&k=${cek}`
}

function is32Bytes(value: string): boolean {
  if (!KEY_OR_TOKEN.test(value)) return false
  try {
    return decodeBase64Url(value).length === 32
  } catch {
    return false
  }
}

export function parseShareFragment(hash: string): ShareLink | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash
  if (fragment === '') return null
  const params = new Map<string, string>()
  for (const part of fragment.split('&')) {
    const separator = part.indexOf('=')
    if (separator <= 0) return null
    const key = part.slice(0, separator)
    if (params.has(key)) return null
    params.set(key, part.slice(separator + 1))
  }
  if (params.size !== 3) return null
  const version = params.get('v')
  const token = params.get('t')
  const cek = params.get('k')
  if (version !== '1' || token === undefined || cek === undefined) return null
  if (!is32Bytes(token) || !is32Bytes(cek)) return null
  return { version: 1, token, cek }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/link.ts frontend/src/link.test.ts
git commit -m "feat(frontend): strict share-link fragment builder and parser

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Frontend config, API client and Spanish messages

**Model:** sonnet

**Files:**
- Create: `frontend/src/config.ts`, `frontend/src/api.ts`, `frontend/src/i18n/messages.ts`, `frontend/src/i18n/format.ts`
- Modify: `frontend/src/vite-env.d.ts` (create it if the scaffold did not)
- Test: `frontend/src/api.test.ts`, `frontend/src/i18n/messages.test.ts`

**Interfaces:**
- Produces:
  - `config: { maxPlaintextBytes: number; oidcIssuer: string; oidcClientId: string }`.
  - `api.ts` types `CreateShareRequest`, `CreateShareResponse`, `ConsumeResponse`, `AdminShareItem`, `AdminSharesPage` (field names exactly as the backend JSON); `class ApiError extends Error { status: number; code: string }` (`status` 0 = network failure, code `network_error`); `createShare(accessToken, body)`, `consumeShare(accessToken, shareToken)`, `listAdminShares(accessToken, page, pageSize)`.
  - `i18n/messages.ts`: `errorMessages: Record<string, string>`, `errorMessage(code: string): string`.
  - `i18n/format.ts`: `formatDateTime(iso: string): string`.

- [ ] **Step 1: Write failing tests**

`frontend/src/api.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, consumeShare, createShare, listAdminShares } from './api'

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('api client', () => {
  it('posts the share token in the JSON body with the OIDC bearer token', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { crypto_version: 1, ciphertext: 'c', nonce: 'n' }))
    vi.stubGlobal('fetch', fetchMock)

    await expect(consumeShare('oidc-token', 'share-token')).resolves.toEqual({ crypto_version: 1, ciphertext: 'c', nonce: 'n' })

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/access/consume')
    expect(init.method).toBe('POST')
    expect(init.cache).toBe('no-store')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer oidc-token', 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual({ access_token: 'share-token' })
  })

  it('posts create requests to /api/v1/shares', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(201, { share_id: 'x', grants: [] }))
    vi.stubGlobal('fetch', fetchMock)
    const body = {
      ciphertext: 'c', nonce: 'n', crypto_version: 1, expires_in_minutes: 60,
      recipients: ['bgonzalez'], shared_token: false, label: null,
    }
    await createShare('oidc-token', body)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/v1/shares')
    expect(JSON.parse(init.body as string)).toEqual(body)
  })

  it('requests admin pages with query parameters', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { items: [], page: 2, page_size: 50, total: 0 }))
    vi.stubGlobal('fetch', fetchMock)
    await listAdminShares('oidc-token', 2, 50)
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/admin/shares?page=2&page_size=50')
  })

  it('maps the error envelope to ApiError', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(410, { error: { code: 'share_already_consumed', message: 'x' } })))
    await expect(consumeShare('t', 's')).rejects.toMatchObject({ status: 410, code: 'share_already_consumed' })
  })

  it('maps a non-JSON 413 from the proxy to invalid_request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Request Entity Too Large', { status: 413 })))
    await expect(createShare('t', {} as never)).rejects.toMatchObject({ status: 413, code: 'invalid_request' })
  })

  it('maps other non-JSON errors to internal_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Bad Gateway', { status: 502 })))
    await expect(consumeShare('t', 's')).rejects.toMatchObject({ status: 502, code: 'internal_error' })
  })

  it('maps network failures to status 0 network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))
    const error = await consumeShare('t', 's').catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 0, code: 'network_error' })
  })
})
```

`frontend/src/i18n/messages.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { errorMessage, errorMessages } from './messages'

const BACKEND_CODES = [
  'authentication_required',
  'invalid_authentication',
  'admin_access_required',
  'share_not_found',
  'share_already_consumed',
  'share_expired',
  'share_revoked',
  'share_payload_deleted',
  'invalid_request',
  'internal_error',
  'network_error',
]

describe('error messages', () => {
  it.each(BACKEND_CODES)('has a Spanish message for %s', (code) => {
    expect(errorMessages[code]).toBeTruthy()
    expect(errorMessage(code)).toBe(errorMessages[code])
  })

  it('falls back to the generic message for unknown codes', () => {
    expect(errorMessage('something_new')).toBe(errorMessages.internal_error)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/api.test.ts src/i18n`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement**

`frontend/src/vite-env.d.ts`:
```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_MAX_PLAINTEXT_BYTES?: string
  readonly VITE_OIDC_ISSUER?: string
  readonly VITE_OIDC_CLIENT_ID?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
```

`frontend/src/config.ts`:
```ts
function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw)
  return Number.isInteger(value) && value > 0 ? value : fallback
}

/** Values injected at build/dev-server start from .env (see compose files). */
export const config = {
  maxPlaintextBytes: positiveInteger(import.meta.env.VITE_MAX_PLAINTEXT_BYTES, 65536),
  oidcIssuer: import.meta.env.VITE_OIDC_ISSUER || 'http://idp.localhost:8080/realms/chismoso',
  oidcClientId: import.meta.env.VITE_OIDC_CLIENT_ID || 'chismoso',
}
```

`frontend/src/api.ts`:
```ts
export interface CreateShareRequest {
  ciphertext: string
  nonce: string
  crypto_version: number
  expires_in_minutes: number
  recipients: string[]
  shared_token: boolean
  label: string | null
}

export interface CreateShareResponse {
  share_id: string
  crypto_version: number
  created_at: string
  expires_at: string
  grants: { recipient: string; access_token: string }[]
}

export interface ConsumeResponse {
  crypto_version: number
  ciphertext: string
  nonce: string
}

export interface AdminShareItem {
  id: string
  creator_identity: string
  label: string | null
  created_at: string
  expires_at: string
  revoked_at: string | null
  payload_deleted_at: string | null
  grants: { recipient_identity: string; consumed_at: string | null }[]
}

export interface AdminSharesPage {
  items: AdminShareItem[]
  page: number
  page_size: number
  total: number
}

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string) {
    super(code)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

async function request<T>(path: string, accessToken: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}` }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let response: Response
  try {
    response = await fetch(path, { ...init, headers, cache: 'no-store' })
  } catch {
    throw new ApiError(0, 'network_error')
  }
  if (!response.ok) {
    let code = response.status === 413 ? 'invalid_request' : 'internal_error'
    try {
      const body: unknown = await response.json()
      const envelopeCode = (body as { error?: { code?: unknown } })?.error?.code
      if (typeof envelopeCode === 'string') code = envelopeCode
    } catch {
      // Non-JSON error body (e.g. from the proxy): keep the status-based code.
    }
    throw new ApiError(response.status, code)
  }
  return (await response.json()) as T
}

export function createShare(accessToken: string, body: CreateShareRequest): Promise<CreateShareResponse> {
  return request('/api/v1/shares', accessToken, { method: 'POST', body: JSON.stringify(body) })
}

export function consumeShare(accessToken: string, shareToken: string): Promise<ConsumeResponse> {
  return request('/api/v1/access/consume', accessToken, {
    method: 'POST',
    body: JSON.stringify({ access_token: shareToken }),
  })
}

export function listAdminShares(accessToken: string, page: number, pageSize: number): Promise<AdminSharesPage> {
  return request(`/api/v1/admin/shares?page=${page}&page_size=${pageSize}`, accessToken)
}
```

`frontend/src/i18n/messages.ts`:
```ts
export const errorMessages: Record<string, string> = {
  authentication_required: 'Tenés que iniciar sesión para continuar.',
  invalid_authentication: 'Tu sesión no es válida o expiró. Iniciá sesión nuevamente.',
  admin_access_required: 'No tenés permisos de administración.',
  share_not_found: 'El enlace no existe o no está destinado a tu usuario.',
  share_already_consumed: 'Este secreto ya fue obtenido. Cada destinatario puede obtenerlo una sola vez.',
  share_expired: 'El enlace expiró. Pedile al remitente que comparta el secreto nuevamente.',
  share_revoked: 'El enlace fue revocado por el remitente.',
  share_payload_deleted: 'El contenido de este enlace ya no está disponible.',
  invalid_request: 'La solicitud no es válida. Revisá los datos ingresados.',
  internal_error: 'Ocurrió un error inesperado. Intentá nuevamente más tarde.',
  network_error: 'No se pudo conectar con el servidor. Revisá tu conexión.',
}

export function errorMessage(code: string): string {
  return errorMessages[code] ?? errorMessages.internal_error
}
```

`frontend/src/i18n/format.ts`:
```ts
export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/config.ts frontend/src/api.ts frontend/src/api.test.ts frontend/src/i18n frontend/src/vite-env.d.ts
git commit -m "feat(frontend): build-time config, typed API client and Spanish error messages

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone 3 — Frontend features

### Task 12: OIDC popup auth, app shell, routes and secure-context gate

**Model:** opus

**Files:**
- Create: `frontend/src/auth/oidc.ts`, `frontend/src/auth/context.ts`, `frontend/src/auth/AuthProvider.tsx`
- Create: `frontend/src/components/Layout.tsx`, `frontend/src/components/LoginPrompt.tsx`, `frontend/src/components/RequireLogin.tsx`, `frontend/src/components/CopyButton.tsx`, `frontend/src/components/InsecureContext.tsx`
- Create: `frontend/src/pages/AuthCallback.tsx`, `frontend/src/pages/NotFound.tsx`, `frontend/src/secureContext.ts`, `frontend/src/test/auth.tsx`
- Create (temporary page shells, replaced in Tasks 13–15): `frontend/src/pages/create/CreatePage.tsx`, `frontend/src/pages/open/OpenPage.tsx`, `frontend/src/pages/admin/AdminPage.tsx`
- Replace: `frontend/src/App.tsx`, `frontend/src/main.tsx`
- Test: `frontend/src/auth/oidc.test.ts`, `frontend/src/auth/AuthProvider.test.tsx`, `frontend/src/components/LoginPrompt.test.tsx`, `frontend/src/pages/AuthCallback.test.tsx`, `frontend/src/App.test.tsx`

**Interfaces:**
- Consumes: `config` (Task 11).
- Produces:
  - `auth/oidc.ts`: `createUserManager(origin?: string): UserManager`.
  - `auth/context.ts`: `interface AuthContextValue { user: User | null; getAccessToken(): string | null; login(): Promise<boolean>; logout(): Promise<void>; expireSession(): void }`, `AuthContext`, `useAuth()`.
  - `auth/AuthProvider.tsx`: `AuthProvider({ userManager: PopupUserManager, children })`, where `PopupUserManager = Pick<UserManager, 'signinPopup' | 'removeUser'>`.
  - `components/LoginPrompt({ message: string; onLoggedIn?: () => void })` renders a button named **"Iniciar sesión"**. On failure it shows an alert containing "bloqueó la ventana emergente".
  - `components/RequireLogin({ children })`, `components/CopyButton({ value: string; label?: string })`.
  - `Layout` header shows **"Sesión: {username}"** when logged in, nav links **"Crear"** (`/`) and **"Administración"** (`/admin`), and buttons "Iniciar sesión" / "Cerrar sesión".
  - `test/auth.tsx`: `TestAuthProvider({ initialToken?, username?, loginSucceeds?, onExpire?, children })`. Its `login()` sets token `'fresh-token'` when `loginSucceeds`; `expireSession()` calls `onExpire` and clears the token.
  - Routes: `/` → `CreatePage`, `/s` → `OpenPage`, `/admin` → `RequireLogin(AdminPage)`, `/auth/callback` → `AuthCallback` (outside `Layout`), `*` → `NotFound`.

- [ ] **Step 1: Write failing tests**

`frontend/src/auth/oidc.test.ts`:
```ts
// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { config } from '../config'
import { createUserManager } from './oidc'

describe('createUserManager', () => {
  it('uses Authorization Code + PKCE via popup with memory-only stores', async () => {
    const manager = createUserManager('http://app.localhost:3000')
    const settings = manager.settings
    expect(settings.authority).toBe(config.oidcIssuer)
    expect(settings.client_id).toBe(config.oidcClientId)
    expect(settings.popup_redirect_uri).toBe('http://app.localhost:3000/auth/callback')
    expect(settings.redirect_uri).toBe('http://app.localhost:3000/auth/callback')
    expect(settings.response_type).toBe('code')
    expect(settings.disablePKCE).toBeFalsy()
    expect(settings.scope).toBe('openid')
    expect(settings.automaticSilentRenew).toBe(false)
    expect(settings.monitorSession).toBe(false)

    await settings.userStore.set('probe', 'user')
    await settings.stateStore.set('probe', 'state')
    expect(await settings.userStore.get('probe')).toBe('user')
    expect(localStorage.length).toBe(0)
    expect(sessionStorage.length).toBe(0)
  })
})
```

`frontend/src/auth/AuthProvider.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { User } from 'oidc-client-ts'
import { useState } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { AuthProvider, type PopupUserManager } from './AuthProvider'
import { useAuth } from './context'

function fakeUser(overrides: Record<string, unknown> = {}): User {
  return {
    access_token: 'access-1',
    expired: false,
    expires_in: 300,
    profile: { preferred_username: 'aperez' },
    ...overrides,
  } as unknown as User
}

function Probe() {
  const auth = useAuth()
  const [result, setResult] = useState('')
  return (
    <div>
      <span data-testid="token">{auth.getAccessToken() ?? 'none'}</span>
      <span data-testid="result">{result}</span>
      <button onClick={() => void auth.login().then((ok) => setResult(ok ? 'ok' : 'failed'))}>login</button>
      <button onClick={auth.expireSession}>expire</button>
    </div>
  )
}

function renderWith(signinPopup: () => Promise<User>) {
  const manager = { signinPopup: vi.fn(signinPopup), removeUser: vi.fn(async () => {}) }
  render(
    <AuthProvider userManager={manager as unknown as PopupUserManager}>
      <Probe />
    </AuthProvider>,
  )
  return manager
}

describe('AuthProvider', () => {
  it('keeps the popup-authenticated user in memory', async () => {
    const manager = renderWith(async () => fakeUser())
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('access-1')).toBeInTheDocument()
    expect(screen.getByTestId('result')).toHaveTextContent('ok')
    expect(manager.signinPopup).toHaveBeenCalledTimes(1)
  })

  it('reports failure when the popup is closed or blocked', async () => {
    renderWith(async () => {
      throw new Error('Popup closed by user')
    })
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('failed')).toBeInTheDocument()
    expect(screen.getByTestId('token')).toHaveTextContent('none')
  })

  it.each([
    ['expired', { expired: true }],
    ['about to expire', { expires_in: 5 }],
  ])('treats an %s token as missing', async (_name, overrides) => {
    renderWith(async () => fakeUser(overrides))
    await userEvent.click(screen.getByText('login'))
    expect(await screen.findByText('ok')).toBeInTheDocument()
    expect(screen.getByTestId('token')).toHaveTextContent('none')
  })

  it('expireSession forgets the user', async () => {
    const manager = renderWith(async () => fakeUser())
    await userEvent.click(screen.getByText('login'))
    await screen.findByText('access-1')
    await userEvent.click(screen.getByText('expire'))
    expect(screen.getByTestId('token')).toHaveTextContent('none')
    expect(manager.removeUser).toHaveBeenCalled()
  })
})
```

`frontend/src/components/LoginPrompt.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TestAuthProvider } from '../test/auth'
import { LoginPrompt } from './LoginPrompt'

describe('LoginPrompt', () => {
  it('explains a blocked or closed popup and stays usable', async () => {
    render(
      <TestAuthProvider loginSucceeds={false}>
        <LoginPrompt message="Iniciá sesión." />
      </TestAuthProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('bloqueó la ventana emergente')
    expect(screen.getByRole('button', { name: 'Iniciar sesión' })).toBeEnabled()
  })

  it('notifies the caller after a successful login', async () => {
    const onLoggedIn = vi.fn()
    render(
      <TestAuthProvider>
        <LoginPrompt message="Iniciá sesión." onLoggedIn={onLoggedIn} />
      </TestAuthProvider>,
    )
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    await vi.waitFor(() => expect(onLoggedIn).toHaveBeenCalledTimes(1))
  })
})
```

`frontend/src/pages/AuthCallback.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import * as api from '../api'
import { AuthCallback } from './AuthCallback'

vi.mock('../api')

describe('AuthCallback', () => {
  it('completes the popup handshake once and never consumes', async () => {
    const manager = { signinPopupCallback: vi.fn(async () => undefined) }
    render(
      <StrictMode>
        <AuthCallback userManager={manager} />
      </StrictMode>,
    )
    await waitFor(() => expect(manager.signinPopupCallback).toHaveBeenCalledTimes(1))
    expect(api.consumeShare).not.toHaveBeenCalled()
  })

  it('shows a Spanish error when the handshake fails', async () => {
    const manager = { signinPopupCallback: vi.fn(async () => Promise.reject(new Error('state mismatch'))) }
    render(<AuthCallback userManager={manager} />)
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar el inicio de sesión')
  })
})
```

`frontend/src/App.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import type { UserManager } from 'oidc-client-ts'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from './App'

const userManager = {
  signinPopup: vi.fn(),
  removeUser: vi.fn(),
  signinPopupCallback: vi.fn(),
} as unknown as UserManager

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('App', () => {
  it('refuses to run outside a secure context', () => {
    vi.stubGlobal('isSecureContext', false)
    render(<App userManager={userManager} />)
    expect(screen.getByRole('alert')).toHaveTextContent('contexto seguro')
  })

  it('refuses to run without WebCrypto', () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('crypto', {})
    render(<App userManager={userManager} />)
    expect(screen.getByRole('alert')).toHaveTextContent('contexto seguro')
  })

  it('renders the create page at / in a secure context', () => {
    vi.stubGlobal('isSecureContext', true)
    vi.stubGlobal('crypto', { subtle: { encrypt: vi.fn() }, getRandomValues: vi.fn() })
    window.history.replaceState(null, '', '/')
    render(<App userManager={userManager} />)
    expect(screen.getByRole('heading', { name: 'Compartir un secreto' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Administración' })).toHaveAttribute('href', '/admin')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL (modules not found).

- [ ] **Step 3: Implement auth**

`frontend/src/auth/oidc.ts`:
```ts
import { InMemoryWebStorage, UserManager, WebStorageStateStore } from 'oidc-client-ts'
import { config } from '../config'

/**
 * Popup-based Authorization Code + PKCE (S256 by default in oidc-client-ts).
 * Tokens and protocol state live in memory only: no localStorage, no refresh tokens, no silent renew.
 */
export function createUserManager(origin: string = window.location.origin): UserManager {
  const callback = `${origin}/auth/callback`
  return new UserManager({
    authority: config.oidcIssuer,
    client_id: config.oidcClientId,
    redirect_uri: callback,
    popup_redirect_uri: callback,
    response_type: 'code',
    scope: 'openid',
    automaticSilentRenew: false,
    monitorSession: false,
    loadUserInfo: false,
    userStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
    stateStore: new WebStorageStateStore({ store: new InMemoryWebStorage() }),
  })
}
```

`frontend/src/auth/context.ts`:
```ts
import type { User } from 'oidc-client-ts'
import { createContext, useContext } from 'react'

export interface AuthContextValue {
  user: User | null
  /** Access token if present and not (about to be) expired; otherwise null. */
  getAccessToken: () => string | null
  /** Opens the Keycloak popup. Call it directly from a click handler. Resolves false on failure/close. */
  login: () => Promise<boolean>
  logout: () => Promise<void>
  /** Forget the user, e.g. after the API answered 401. */
  expireSession: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside an AuthProvider')
  return value
}
```

`frontend/src/auth/AuthProvider.tsx`:
```tsx
import type { User, UserManager } from 'oidc-client-ts'
import { type ReactNode, useCallback, useMemo, useState } from 'react'
import { AuthContext, type AuthContextValue } from './context'

const MIN_TOKEN_LIFETIME_SECONDS = 10

export type PopupUserManager = Pick<UserManager, 'signinPopup' | 'removeUser'>

export function AuthProvider({ userManager, children }: { userManager: PopupUserManager; children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)

  const login = useCallback(async () => {
    try {
      setUser(await userManager.signinPopup())
      return true
    } catch {
      return false
    }
  }, [userManager])

  const logout = useCallback(async () => {
    setUser(null)
    await userManager.removeUser()
  }, [userManager])

  const expireSession = useCallback(() => {
    setUser(null)
    void userManager.removeUser()
  }, [userManager])

  const getAccessToken = useCallback(() => {
    if (!user || user.expired) return null
    if ((user.expires_in ?? 0) <= MIN_TOKEN_LIFETIME_SECONDS) return null
    return user.access_token
  }, [user])

  const value = useMemo<AuthContextValue>(
    () => ({ user, getAccessToken, login, logout, expireSession }),
    [user, getAccessToken, login, logout, expireSession],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
```

`frontend/src/test/auth.tsx`:
```tsx
import type { User } from 'oidc-client-ts'
import { type ReactNode, useState } from 'react'
import { AuthContext, type AuthContextValue } from '../auth/context'

interface TestAuthProviderProps {
  initialToken?: string | null
  username?: string
  loginSucceeds?: boolean
  onExpire?: () => void
  children: ReactNode
}

/** Auth double for component tests: login() "succeeds" by setting the token 'fresh-token'. */
export function TestAuthProvider({
  initialToken = null,
  username = 'bgonzalez',
  loginSucceeds = true,
  onExpire,
  children,
}: TestAuthProviderProps) {
  const [token, setToken] = useState<string | null>(initialToken)
  const value: AuthContextValue = {
    user: token ? ({ access_token: token, profile: { preferred_username: username } } as unknown as User) : null,
    getAccessToken: () => token,
    login: async () => {
      if (loginSucceeds) setToken('fresh-token')
      return loginSucceeds
    },
    logout: async () => setToken(null),
    expireSession: () => {
      onExpire?.()
      setToken(null)
    },
  }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
```

- [ ] **Step 4: Implement components, pages and shell**

`frontend/src/components/LoginPrompt.tsx`:
```tsx
import { useState } from 'react'
import { useAuth } from '../auth/context'

export function LoginPrompt({ message, onLoggedIn }: { message: string; onLoggedIn?: () => void }) {
  const { login } = useAuth()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  function handleClick() {
    setBusy(true)
    setFailed(false)
    // login() opens the popup synchronously inside this click handler, so popup blockers allow it.
    void login().then((ok) => {
      setBusy(false)
      if (ok) onLoggedIn?.()
      else setFailed(true)
    })
  }

  return (
    <div className="notice">
      <p>{message}</p>
      <button type="button" onClick={handleClick} disabled={busy}>
        Iniciar sesión
      </button>
      {failed && (
        <p role="alert" className="error">
          No se pudo iniciar sesión. Si el navegador bloqueó la ventana emergente, permitila e intentá nuevamente.
        </p>
      )}
    </div>
  )
}
```

`frontend/src/components/RequireLogin.tsx`:
```tsx
import type { ReactNode } from 'react'
import { useAuth } from '../auth/context'
import { LoginPrompt } from './LoginPrompt'

export function RequireLogin({ children }: { children: ReactNode }) {
  const { getAccessToken } = useAuth()
  if (getAccessToken() === null) return <LoginPrompt message="Iniciá sesión para continuar." />
  return <>{children}</>
}
```

`frontend/src/components/CopyButton.tsx`:
```tsx
import { useState } from 'react'

export function CopyButton({ value, label = 'Copiar' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  async function copy() {
    try {
      await navigator.clipboard.writeText(value)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 2000)
    } catch {
      setCopied(false)
    }
  }

  return (
    <button type="button" onClick={() => void copy()}>
      {copied ? 'Copiado' : label}
    </button>
  )
}
```

`frontend/src/components/InsecureContext.tsx`:
```tsx
export function InsecureContext() {
  return (
    <main>
      <h1>Chismoso</h1>
      <p role="alert" className="error">
        Este navegador no ofrece un contexto seguro con criptografía web (WebCrypto). Abrí Chismoso desde su
        dirección oficial (HTTPS) con un navegador actualizado.
      </p>
    </main>
  )
}
```

`frontend/src/components/Layout.tsx`:
```tsx
import { Link, NavLink, Outlet } from 'react-router'
import { useAuth } from '../auth/context'

export function Layout() {
  const { user, login, logout } = useAuth()
  return (
    <>
      <header className="app-header">
        <Link to="/" className="brand">
          Chismoso
        </Link>
        <nav>
          <NavLink to="/" end>
            Crear
          </NavLink>
          <NavLink to="/admin">Administración</NavLink>
        </nav>
        <div>
          {user ? (
            <>
              <span>Sesión: {user.profile.preferred_username}</span>{' '}
              <button type="button" onClick={() => void logout()}>
                Cerrar sesión
              </button>
            </>
          ) : (
            <button type="button" onClick={() => void login()}>
              Iniciar sesión
            </button>
          )}
        </div>
      </header>
      <main>
        <Outlet />
      </main>
    </>
  )
}
```

`frontend/src/pages/AuthCallback.tsx`:
```tsx
import type { UserManager } from 'oidc-client-ts'
import { useEffect, useRef, useState } from 'react'

/** Runs inside the login popup: hands the authorization response back to the opener tab. Never consumes. */
export function AuthCallback({ userManager }: { userManager: Pick<UserManager, 'signinPopupCallback'> }) {
  const started = useRef(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    userManager.signinPopupCallback().catch(() => setFailed(true))
  }, [userManager])

  return (
    <main>
      {failed ? (
        <p role="alert" className="error">
          No se pudo completar el inicio de sesión. Cerrá esta ventana e intentá nuevamente.
        </p>
      ) : (
        <p role="status">Completando el inicio de sesión…</p>
      )}
    </main>
  )
}
```

`frontend/src/pages/NotFound.tsx`:
```tsx
import { Link } from 'react-router'

export function NotFound() {
  return (
    <section>
      <h1>Página no encontrada</h1>
      <p>
        <Link to="/">Volver al inicio</Link>
      </p>
    </section>
  )
}
```

`frontend/src/secureContext.ts`:
```ts
/** WebCrypto is only available in secure contexts (HTTPS or *.localhost). No fallback is allowed. */
export function isSecureCryptoAvailable(): boolean {
  return globalThis.isSecureContext === true && typeof globalThis.crypto?.subtle?.encrypt === 'function'
}
```

Temporary page shells (Tasks 13–15 replace them):

`frontend/src/pages/create/CreatePage.tsx`:
```tsx
export function CreatePage() {
  return <h1>Compartir un secreto</h1>
}
```

`frontend/src/pages/open/OpenPage.tsx`:
```tsx
export function OpenPage() {
  return <h1>Secreto compartido</h1>
}
```

`frontend/src/pages/admin/AdminPage.tsx`:
```tsx
export function AdminPage() {
  return <h1>Administración</h1>
}
```

Replace `frontend/src/App.tsx`:
```tsx
import type { UserManager } from 'oidc-client-ts'
import { BrowserRouter, Route, Routes } from 'react-router'
import { AuthProvider } from './auth/AuthProvider'
import { InsecureContext } from './components/InsecureContext'
import { Layout } from './components/Layout'
import { RequireLogin } from './components/RequireLogin'
import { AdminPage } from './pages/admin/AdminPage'
import { AuthCallback } from './pages/AuthCallback'
import { CreatePage } from './pages/create/CreatePage'
import { NotFound } from './pages/NotFound'
import { OpenPage } from './pages/open/OpenPage'
import { isSecureCryptoAvailable } from './secureContext'

export function App({ userManager }: { userManager: UserManager }) {
  if (!isSecureCryptoAvailable()) return <InsecureContext />
  return (
    <AuthProvider userManager={userManager}>
      <BrowserRouter>
        <Routes>
          <Route path="/auth/callback" element={<AuthCallback userManager={userManager} />} />
          <Route element={<Layout />}>
            <Route index element={<CreatePage />} />
            <Route path="s" element={<OpenPage />} />
            <Route
              path="admin"
              element={
                <RequireLogin>
                  <AdminPage />
                </RequireLogin>
              }
            />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
```

Replace `frontend/src/main.tsx`:
```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { createUserManager } from './auth/oidc'
import './index.css'

const userManager = createUserManager()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App userManager={userManager} />
  </StrictMode>,
)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test && npm run build && npm run lint`
Expected: PASS. If the installed react-router major version does not export `BrowserRouter`, `Routes`, `Route`, `Link`, `NavLink` or `Outlet` from `'react-router'`, use its documented declarative-mode equivalents.

- [ ] **Step 6: Commit** (the real popup round-trip against Keycloak, and the empty browser storage after login, are verified in Task 16)

```bash
git add frontend/src/auth frontend/src/components frontend/src/pages frontend/src/test/auth.tsx frontend/src/secureContext.ts frontend/src/App.tsx frontend/src/App.test.tsx frontend/src/main.tsx
git commit -m "feat(frontend): memory-only OIDC popup auth, app shell, routes and secure-context gate

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13: Create page — local encryption, recipients, expiry, links

**Model:** sonnet

**Files:**
- Create: `frontend/src/pages/create/recipients.ts`, `frontend/src/pages/create/expiry.ts`
- Replace: `frontend/src/pages/create/CreatePage.tsx`
- Test: `frontend/src/pages/create/recipients.test.ts`, `frontend/src/pages/create/expiry.test.ts`, `frontend/src/pages/create/CreatePage.test.tsx`

**Interfaces:**
- Consumes: `useAuth`, `LoginPrompt`, `CopyButton`, `config`, `encryptV1`, `CRYPTO_VERSION`, `createShare`, `ApiError`, `errorMessage`, `formatDateTime`, `buildShareLink`, `TestAuthProvider`.
- Produces:
  - `parseRecipients(input: string): { ok: true; recipients: string[] } | { ok: false; error: string }`.
  - `EXPIRY_PRESETS` (`{ label, minutes }[]`), `DEFAULT_EXPIRY_MINUTES = 60`, `CUSTOM_EXPIRY = 'custom'`, `parseCustomMinutes(raw: string): number | null`.
  - `CreatePage` with exact accessible labels **"Secreto"**, **"Destinatarios"**, **"Etiqueta (opcional)"**, **"Vencimiento"**, **"Minutos"** (custom only), checkbox **"Usar un único enlace para todos los destinatarios"**, and submit button **"Cifrar y crear enlaces"**. The result list is `<ul data-testid="share-links">` with `<li data-recipient="{username}">` containing `<code>{link}</code>`. The over-limit hint contains **"supera el tamaño máximo"**. Task 16's e2e relies on these strings.

- [ ] **Step 1: Write failing tests**

`frontend/src/pages/create/recipients.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { parseRecipients } from './recipients'

describe('parseRecipients', () => {
  it('splits on commas, semicolons and whitespace, trimming and lowercasing', () => {
    expect(parseRecipients(' BGonzalez, csaul;dlopez\nefuseneco  ')).toEqual({
      ok: true,
      recipients: ['bgonzalez', 'csaul', 'dlopez', 'efuseneco'],
    })
  })

  it.each([
    ['empty', '', 'al menos un destinatario'],
    ['only separators', ' , ; ', 'al menos un destinatario'],
    ['email', 'bgonzalez@corp.example', 'no direcciones de correo'],
    ['duplicate after normalization', 'bgonzalez, BGONZALEZ', 'repetido'],
    ['invalid syntax', 'b!gonzalez', 'no es un nombre de usuario válido'],
  ])('rejects %s', (_name, input, message) => {
    const result = parseRecipients(input)
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain(message)
  })
})
```

`frontend/src/pages/create/expiry.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXPIRY_MINUTES, EXPIRY_PRESETS, parseCustomMinutes } from './expiry'

describe('expiry presets', () => {
  it('matches the spec presets', () => {
    expect(EXPIRY_PRESETS.map((p) => [p.label, p.minutes])).toEqual([
      ['10 minutos', 10],
      ['1 hora', 60],
      ['1 día', 1440],
      ['7 días', 10080],
      ['15 días', 21600],
      ['30 días', 43200],
    ])
    expect(DEFAULT_EXPIRY_MINUTES).toBe(60)
  })

  it.each([
    ['90', 90],
    [' 15 ', 15],
    ['0', null],
    ['-5', null],
    ['1.5', null],
    ['abc', null],
    ['', null],
  ])('parses custom minutes %j', (raw, expected) => {
    expect(parseCustomMinutes(raw)).toBe(expected)
  })
})
```

`frontend/src/pages/create/CreatePage.test.tsx`:
```tsx
// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
import { errorMessages } from '../../i18n/messages'
import { TestAuthProvider } from '../../test/auth'
import { CreatePage } from './CreatePage'

const CEK = 'C'.repeat(43)

vi.mock('../../crypto/v1', () => ({
  CRYPTO_VERSION: 1,
  encryptV1: vi.fn(async () => ({ cek: 'C'.repeat(43), nonce: 'N'.repeat(16), ciphertext: 'X'.repeat(30) })),
}))

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, createShare: vi.fn() }
})

const createShare = vi.mocked(api.createShare)

const RESPONSE = {
  share_id: 'id',
  crypto_version: 1,
  created_at: '2026-10-08T20:00:00Z',
  expires_at: '2026-10-08T21:00:00Z',
  grants: [
    { recipient: 'bgonzalez', access_token: 'T'.repeat(43) },
    { recipient: 'csaul', access_token: 'U'.repeat(43) },
  ],
}

function renderPage(initialToken: string | null = 'oidc-token', onExpire = vi.fn()) {
  render(
    <TestAuthProvider initialToken={initialToken} onExpire={onExpire}>
      <CreatePage />
    </TestAuthProvider>,
  )
  return { onExpire }
}

function fillForm(plaintext = 'hunter2', recipients = ' BGonzalez, csaul ') {
  fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: plaintext } })
  fireEvent.change(screen.getByLabelText('Destinatarios'), { target: { value: recipients } })
}

const submit = () => userEvent.click(screen.getByRole('button', { name: 'Cifrar y crear enlaces' }))

beforeEach(() => {
  createShare.mockReset()
})

describe('CreatePage', () => {
  it('sends only ciphertext and shows one fragment link per recipient', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    await submit()

    expect(createShare).toHaveBeenCalledWith('oidc-token', {
      ciphertext: 'X'.repeat(30),
      nonce: 'N'.repeat(16),
      crypto_version: 1,
      expires_in_minutes: 60,
      recipients: ['bgonzalez', 'csaul'],
      shared_token: false,
      label: null,
    })
    const sent = JSON.stringify(createShare.mock.calls[0])
    expect(sent).not.toContain('hunter2')
    expect(sent).not.toContain(CEK)

    const list = await screen.findByTestId('share-links')
    expect(list.querySelector('li[data-recipient="bgonzalez"] code')?.textContent).toBe(
      `${window.location.origin}/s#v=1&t=${'T'.repeat(43)}&k=${CEK}`,
    )
    expect(list.querySelector('li[data-recipient="csaul"] code')?.textContent).toContain(`t=${'U'.repeat(43)}`)
  })

  it('sends label, shared mode and custom expiry', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    fireEvent.change(screen.getByLabelText('Etiqueta (opcional)'), { target: { value: '  Staging DB  ' } })
    await userEvent.click(screen.getByLabelText('Usar un único enlace para todos los destinatarios'))
    await userEvent.selectOptions(screen.getByLabelText('Vencimiento'), 'Personalizado')
    fireEvent.change(screen.getByLabelText('Minutos'), { target: { value: '90' } })
    await submit()
    expect(createShare.mock.calls[0][1]).toMatchObject({ label: 'Staging DB', shared_token: true, expires_in_minutes: 90 })
  })

  it('rejects email recipients without calling the API', async () => {
    renderPage()
    fillForm('hunter2', 'bgonzalez@corp.example')
    await submit()
    expect(screen.getByRole('alert')).toHaveTextContent('no direcciones de correo')
    expect(createShare).not.toHaveBeenCalled()
  })

  it('measures the limit in UTF-8 bytes, not characters', () => {
    renderPage()
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'ñ'.repeat(32769) } }) // 65,538 bytes
    expect(screen.getByText(/supera el tamaño máximo/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cifrar y crear enlaces' })).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Secreto'), { target: { value: 'a'.repeat(65536) } })
    expect(screen.queryByText(/supera el tamaño máximo/)).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Cifrar y crear enlaces' })).toBeEnabled()
  })

  it('keeps the typed secret when the session is missing at submit and continues after login', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage(null)
    fillForm()
    await submit()
    expect(createShare).not.toHaveBeenCalled()
    expect(screen.getByText(/Tu sesión expiró/)).toBeInTheDocument()
    expect(screen.getByLabelText('Secreto')).toHaveValue('hunter2')

    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    await submit()
    expect(createShare).toHaveBeenCalledWith('fresh-token', expect.objectContaining({ recipients: ['bgonzalez', 'csaul'] }))
  })

  it('handles a 401 by asking to log in again without losing the form', async () => {
    createShare.mockRejectedValue(new ApiError(401, 'invalid_authentication'))
    const { onExpire } = renderPage()
    fillForm()
    await submit()
    expect(onExpire).toHaveBeenCalled()
    expect(await screen.findByText(/Tu sesión expiró/)).toBeInTheDocument()
    expect(screen.getByLabelText('Secreto')).toHaveValue('hunter2')
  })

  it('shows backend validation errors in Spanish', async () => {
    createShare.mockRejectedValue(new ApiError(422, 'invalid_request'))
    renderPage()
    fillForm()
    await submit()
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessages.invalid_request)
  })

  it('starts over with an empty form', async () => {
    createShare.mockResolvedValue(RESPONSE)
    renderPage()
    fillForm()
    await submit()
    await userEvent.click(await screen.findByRole('button', { name: 'Compartir otro secreto' }))
    expect(screen.getByLabelText('Secreto')).toHaveValue('')
    expect(screen.getByLabelText('Destinatarios')).toHaveValue('')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/create`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/pages/create/recipients.ts`:
```ts
const USERNAME = /^[a-z0-9][a-z0-9._-]{0,63}$/

export type RecipientsResult = { ok: true; recipients: string[] } | { ok: false; error: string }

/** Mirrors backend canonicalization for friendly errors; the backend stays authoritative. */
export function parseRecipients(input: string): RecipientsResult {
  const recipients = input
    .split(/[\s,;]+/)
    .map((item) => item.trim().toLowerCase())
    .filter((item) => item !== '')
  if (recipients.length === 0) return { ok: false, error: 'Ingresá al menos un destinatario.' }
  if (recipients.some((item) => item.includes('@'))) {
    return { ok: false, error: 'Ingresá nombres de usuario, no direcciones de correo.' }
  }
  const invalid = recipients.find((item) => !USERNAME.test(item))
  if (invalid !== undefined) return { ok: false, error: `«${invalid}» no es un nombre de usuario válido.` }
  const duplicate = recipients.find((item, index) => recipients.indexOf(item) !== index)
  if (duplicate !== undefined) return { ok: false, error: `El destinatario «${duplicate}» está repetido.` }
  return { ok: true, recipients }
}
```

`frontend/src/pages/create/expiry.ts`:
```ts
export const EXPIRY_PRESETS = [
  { label: '10 minutos', minutes: 10 },
  { label: '1 hora', minutes: 60 },
  { label: '1 día', minutes: 1440 },
  { label: '7 días', minutes: 10080 },
  { label: '15 días', minutes: 21600 },
  { label: '30 días', minutes: 43200 },
] as const

export const DEFAULT_EXPIRY_MINUTES = 60
export const CUSTOM_EXPIRY = 'custom'

/** Positive integer minutes, or null. Range limits are enforced by the backend. */
export function parseCustomMinutes(raw: string): number | null {
  const value = raw.trim()
  if (!/^\d+$/.test(value)) return null
  const minutes = Number(value)
  return minutes > 0 ? minutes : null
}
```

Replace `frontend/src/pages/create/CreatePage.tsx`:
```tsx
import { type FormEvent, useState } from 'react'
import { ApiError, createShare } from '../../api'
import { useAuth } from '../../auth/context'
import { CopyButton } from '../../components/CopyButton'
import { LoginPrompt } from '../../components/LoginPrompt'
import { config } from '../../config'
import { CRYPTO_VERSION, encryptV1 } from '../../crypto/v1'
import { formatDateTime } from '../../i18n/format'
import { errorMessage } from '../../i18n/messages'
import { buildShareLink } from '../../link'
import { CUSTOM_EXPIRY, DEFAULT_EXPIRY_MINUTES, EXPIRY_PRESETS, parseCustomMinutes } from './expiry'
import { parseRecipients } from './recipients'

interface CreatedLinks {
  expiresAt: string
  shared: boolean
  links: { recipient: string; link: string }[]
}

const utf8 = new TextEncoder()

export function CreatePage() {
  const { getAccessToken, expireSession } = useAuth()
  const [plaintext, setPlaintext] = useState('')
  const [recipientsInput, setRecipientsInput] = useState('')
  const [label, setLabel] = useState('')
  const [sharedToken, setSharedToken] = useState(false)
  const [expiry, setExpiry] = useState(String(DEFAULT_EXPIRY_MINUTES))
  const [customMinutes, setCustomMinutes] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [sessionExpired, setSessionExpired] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<CreatedLinks | null>(null)

  const plaintextBytes = utf8.encode(plaintext).length
  const tooLarge = plaintextBytes > config.maxPlaintextBytes
  const loggedIn = getAccessToken() !== null

  function resetForm() {
    setCreated(null)
    setRecipientsInput('')
    setLabel('')
    setSharedToken(false)
    setExpiry(String(DEFAULT_EXPIRY_MINUTES))
    setCustomMinutes('')
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setError(null)
    if (plaintext === '') {
      setError('Ingresá el secreto a compartir.')
      return
    }
    if (tooLarge) {
      setError('El secreto supera el tamaño máximo permitido.')
      return
    }
    const recipients = parseRecipients(recipientsInput)
    if (!recipients.ok) {
      setError(recipients.error)
      return
    }
    const minutes = expiry === CUSTOM_EXPIRY ? parseCustomMinutes(customMinutes) : Number(expiry)
    if (minutes === null) {
      setError('Ingresá una cantidad entera de minutos mayor a cero.')
      return
    }
    const accessToken = getAccessToken()
    if (accessToken === null) {
      // Keep everything typed; the user logs in and submits again.
      setSessionExpired(true)
      return
    }

    setSubmitting(true)
    try {
      const encrypted = await encryptV1(plaintext)
      const response = await createShare(accessToken, {
        ciphertext: encrypted.ciphertext,
        nonce: encrypted.nonce,
        crypto_version: CRYPTO_VERSION,
        expires_in_minutes: minutes,
        recipients: recipients.recipients,
        shared_token: sharedToken,
        label: label.trim() === '' ? null : label.trim(),
      })
      setCreated({
        expiresAt: response.expires_at,
        shared: sharedToken,
        links: response.grants.map((grant) => ({
          recipient: grant.recipient,
          link: buildShareLink(window.location.origin, grant.access_token, encrypted.cek),
        })),
      })
      setPlaintext('')
      setSessionExpired(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession()
        setSessionExpired(true)
      } else {
        setError(errorMessage(err instanceof ApiError ? err.code : 'internal_error'))
      }
    } finally {
      setSubmitting(false)
    }
  }

  if (created) return <CreatedLinksView created={created} onReset={resetForm} />

  return (
    <section>
      <h1>Compartir un secreto</h1>
      <p className="hint">El secreto se cifra en tu navegador. El servidor nunca recibe el texto ni la clave.</p>
      {!loggedIn && (
        <LoginPrompt
          message={
            sessionExpired
              ? 'Tu sesión expiró. Iniciá sesión nuevamente para crear los enlaces; lo que escribiste se conserva.'
              : 'Iniciá sesión para compartir un secreto.'
          }
          onLoggedIn={() => setSessionExpired(false)}
        />
      )}
      <form onSubmit={(event) => void handleSubmit(event)} noValidate>
        <label htmlFor="plaintext">Secreto</label>
        <textarea
          id="plaintext"
          rows={6}
          value={plaintext}
          onChange={(event) => setPlaintext(event.target.value)}
          autoComplete="off"
          spellCheck={false}
        />
        <p className={tooLarge ? 'hint error' : 'hint'}>
          {plaintextBytes} / {config.maxPlaintextBytes} bytes
          {tooLarge && ' — el secreto supera el tamaño máximo permitido.'}
        </p>

        <label htmlFor="recipients">Destinatarios</label>
        <input
          id="recipients"
          type="text"
          value={recipientsInput}
          onChange={(event) => setRecipientsInput(event.target.value)}
          autoComplete="off"
        />
        <p className="hint">Nombres de usuario separados por comas o espacios (por ejemplo: bgonzalez, csaul).</p>

        <label htmlFor="label">Etiqueta (opcional)</label>
        <input id="label" type="text" value={label} onChange={(event) => setLabel(event.target.value)} />
        <p className="hint">La ven los administradores. No incluyas información secreta.</p>

        <label htmlFor="expiry">Vencimiento</label>
        <select id="expiry" value={expiry} onChange={(event) => setExpiry(event.target.value)}>
          {EXPIRY_PRESETS.map((preset) => (
            <option key={preset.minutes} value={String(preset.minutes)}>
              {preset.label}
            </option>
          ))}
          <option value={CUSTOM_EXPIRY}>Personalizado</option>
        </select>
        {expiry === CUSTOM_EXPIRY && (
          <>
            <label htmlFor="custom-minutes">Minutos</label>
            <input
              id="custom-minutes"
              type="number"
              min={1}
              step={1}
              inputMode="numeric"
              value={customMinutes}
              onChange={(event) => setCustomMinutes(event.target.value)}
            />
          </>
        )}

        <label className="checkbox">
          <input type="checkbox" checked={sharedToken} onChange={(event) => setSharedToken(event.target.checked)} />{' '}
          Usar un único enlace para todos los destinatarios
        </label>

        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button type="submit" disabled={submitting || tooLarge}>
          {submitting ? 'Cifrando…' : 'Cifrar y crear enlaces'}
        </button>
      </form>
    </section>
  )
}

function CreatedLinksView({ created, onReset }: { created: CreatedLinks; onReset: () => void }) {
  return (
    <section>
      <h1>Enlaces creados</h1>
      <p>
        Enviá cada enlace únicamente a su destinatario, por el canal que prefieras. Chismoso no envía los enlaces y no
        puede volver a mostrarlos.
      </p>
      {created.shared && (
        <p className="hint">
          Enlace único: todos los destinatarios reciben el mismo enlace, pero cada uno puede usarlo una sola vez con su
          propio usuario.
        </p>
      )}
      <p className="hint">Vence: {formatDateTime(created.expiresAt)}</p>
      <ul className="links" data-testid="share-links">
        {created.links.map(({ recipient, link }) => (
          <li key={recipient} data-recipient={recipient}>
            <strong>{recipient}</strong>
            <code>{link}</code>
            <CopyButton value={link} label="Copiar enlace" />
          </li>
        ))}
      </ul>
      <button type="button" onClick={onReset}>
        Compartir otro secreto
      </button>
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/create
git commit -m "feat(frontend): create page with local encryption, recipient checks and copyable links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Open page — explicit one-time reveal state machine

**Model:** opus

**Files:**
- Replace: `frontend/src/pages/open/OpenPage.tsx`
- Test: `frontend/src/pages/open/OpenPage.test.tsx`

**Interfaces:**
- Consumes: `parseShareFragment`, `ShareLink`, `consumeShare`, `ConsumeResponse`, `ApiError`, `decryptV1`, `useAuth`, `LoginPrompt`, `CopyButton`, `errorMessage`, `TestAuthProvider`.
- Produces: `OpenPage`. User-visible contract used by Task 16:
  - Malformed link: alert containing **"El enlace está incompleto o no es válido"**; no login and no consume.
  - Logged out: `LoginPrompt`.
  - Ready: button **"Revelar secreto"**.
  - Revealed: read-only textarea labelled **"Secreto revelado"**.
  - Decrypt failure: alert containing **"ya fue consumido"**.
  - Uncertain failure (network or 5xx): alert containing **"Es posible que el secreto ya se haya obtenido"**, plus button **"Intentar nuevamente"**.
  - 404/410: `errorMessage(code)` with no retry.

- [ ] **Step 1: Write failing tests**

`frontend/src/pages/open/OpenPage.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
import { encodeBase64Url } from '../../crypto/base64url'
import * as v1 from '../../crypto/v1'
import { DecryptionError } from '../../crypto/v1'
import { errorMessages } from '../../i18n/messages'
import { TestAuthProvider } from '../../test/auth'
import { OpenPage } from './OpenPage'

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, consumeShare: vi.fn() }
})
vi.mock('../../crypto/v1', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../crypto/v1')>()
  return { ...actual, decryptV1: vi.fn() }
})

const consumeShare = vi.mocked(api.consumeShare)
const decryptV1 = vi.mocked(v1.decryptV1)

const TOKEN = encodeBase64Url(new Uint8Array(32).fill(7))
const CEK = encodeBase64Url(new Uint8Array(32).fill(9))
const VALID = `v=1&t=${TOKEN}&k=${CEK}`
const PAYLOAD = { crypto_version: 1, ciphertext: 'ct', nonce: 'nn' }

function openAt(fragment: string, initialToken: string | null = 'oidc-token', onExpire = vi.fn()) {
  window.history.replaceState(null, '', `/s#${fragment}`)
  render(
    <TestAuthProvider initialToken={initialToken} onExpire={onExpire}>
      <OpenPage />
    </TestAuthProvider>,
  )
  return { onExpire }
}

const reveal = () => userEvent.click(screen.getByRole('button', { name: 'Revelar secreto' }))

beforeEach(() => {
  consumeShare.mockReset()
  decryptV1.mockReset()
})

describe('OpenPage', () => {
  it.each([
    ['empty fragment', ''],
    ['version only', 'v=1'],
    ['unsupported version', `v=2&t=${TOKEN}&k=${CEK}`],
    ['short token', `v=1&t=abc&k=${CEK}`],
    ['trailing parenthesis', `${VALID})`],
  ])('shows a malformed-link error and never consumes: %s', (_name, fragment) => {
    openAt(fragment)
    expect(screen.getByRole('alert')).toHaveTextContent('El enlace está incompleto o no es válido')
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Iniciar sesión' })).not.toBeInTheDocument()
    expect(consumeShare).not.toHaveBeenCalled()
  })

  it('asks for login first, and login alone never consumes', async () => {
    openAt(VALID, null)
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Iniciar sesión' }))
    expect(await screen.findByRole('button', { name: 'Revelar secreto' })).toBeInTheDocument()
    expect(screen.getByText(/una sola vez/)).toBeInTheDocument()
    expect(consumeShare).not.toHaveBeenCalled()
  })

  it('consumes once on explicit click and decrypts locally', async () => {
    consumeShare.mockResolvedValue(PAYLOAD)
    decryptV1.mockResolvedValue('the secret')
    openAt(VALID)
    await reveal()
    expect(await screen.findByLabelText('Secreto revelado')).toHaveValue('the secret')
    expect(consumeShare).toHaveBeenCalledTimes(1)
    expect(consumeShare).toHaveBeenCalledWith('oidc-token', TOKEN)
    expect(decryptV1).toHaveBeenCalledWith({ cek: CEK, nonce: 'nn', ciphertext: 'ct' })
    expect(screen.queryByRole('button', { name: 'Revelar secreto' })).not.toBeInTheDocument()
  })

  it('explains that a wrong key consumed the grant, without retrying', async () => {
    consumeShare.mockResolvedValue(PAYLOAD)
    decryptV1.mockRejectedValue(new DecryptionError())
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue consumido')
    expect(consumeShare).toHaveBeenCalledTimes(1)
    expect(screen.queryByRole('button', { name: /Revelar secreto|Intentar nuevamente/ })).not.toBeInTheDocument()
  })

  it('treats an unexpected crypto_version as a decryption failure', async () => {
    consumeShare.mockResolvedValue({ ...PAYLOAD, crypto_version: 2 })
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent('ya fue consumido')
    expect(decryptV1).not.toHaveBeenCalled()
  })

  it.each([
    [410, 'share_already_consumed'],
    [410, 'share_expired'],
    [404, 'share_not_found'],
  ])('shows %s %s without offering a retry', async (status, code) => {
    consumeShare.mockRejectedValue(new ApiError(status, code))
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent(errorMessages[code])
    expect(screen.queryByRole('button', { name: /Revelar secreto|Intentar nuevamente/ })).not.toBeInTheDocument()
    expect(consumeShare).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['network failure', new ApiError(0, 'network_error')],
    ['server error', new ApiError(500, 'internal_error')],
  ])('on %s warns it may be consumed and only retries on explicit click', async (_name, failure) => {
    consumeShare.mockRejectedValueOnce(failure).mockResolvedValueOnce(PAYLOAD)
    decryptV1.mockResolvedValue('the secret')
    openAt(VALID)
    await reveal()
    expect(await screen.findByRole('alert')).toHaveTextContent('Es posible que el secreto ya se haya obtenido')
    expect(consumeShare).toHaveBeenCalledTimes(1)
    await userEvent.click(screen.getByRole('button', { name: 'Intentar nuevamente' }))
    expect(await screen.findByLabelText('Secreto revelado')).toHaveValue('the secret')
    expect(consumeShare).toHaveBeenCalledTimes(2)
  })

  it('on 401 drops the session and asks to log in again', async () => {
    consumeShare.mockRejectedValue(new ApiError(401, 'invalid_authentication'))
    const { onExpire } = openAt(VALID)
    await reveal()
    expect(onExpire).toHaveBeenCalled()
    expect(await screen.findByRole('button', { name: 'Iniciar sesión' })).toBeInTheDocument()
    expect(consumeShare).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/open`
Expected: FAIL (shell page has none of this behavior).

- [ ] **Step 3: Implement**

Replace `frontend/src/pages/open/OpenPage.tsx`:
```tsx
import { useState } from 'react'
import { ApiError, type ConsumeResponse, consumeShare } from '../../api'
import { useAuth } from '../../auth/context'
import { CopyButton } from '../../components/CopyButton'
import { LoginPrompt } from '../../components/LoginPrompt'
import { decryptV1 } from '../../crypto/v1'
import { errorMessage } from '../../i18n/messages'
import { parseShareFragment, type ShareLink } from '../../link'

type Phase =
  | { kind: 'idle' }
  | { kind: 'consuming' }
  | { kind: 'revealed'; plaintext: string }
  | { kind: 'decrypt_failed' }
  | { kind: 'failed'; message: string; canRetry: boolean }

const DECRYPT_FAILED_MESSAGE =
  'El secreto se obtuvo del servidor, pero no se pudo descifrar: el enlace parece alterado o incompleto. ' +
  'Este acceso de un solo uso ya fue consumido; pedile al remitente que comparta el secreto nuevamente.'

const UNCERTAIN_MESSAGE =
  'No se pudo confirmar la respuesta del servidor. Es posible que el secreto ya se haya obtenido; ' +
  'si al reintentar figura como ya obtenido, pedile al remitente un enlace nuevo.'

export function OpenPage() {
  const { user, getAccessToken, expireSession } = useAuth()
  // Parsed once, kept in memory for this tab only. Nothing here is sent anywhere until the explicit click.
  const [link] = useState<ShareLink | null>(() => parseShareFragment(window.location.hash))
  const [phase, setPhase] = useState<Phase>({ kind: 'idle' })

  if (link === null) {
    return (
      <section>
        <h1>Enlace no válido</h1>
        <p role="alert" className="error">
          El enlace está incompleto o no es válido. Verificá que lo hayas copiado completo o pedile al remitente que lo
          envíe nuevamente.
        </p>
      </section>
    )
  }

  async function reveal(current: ShareLink) {
    const accessToken = getAccessToken()
    if (accessToken === null) {
      expireSession()
      setPhase({ kind: 'idle' })
      return
    }
    setPhase({ kind: 'consuming' })
    let payload: ConsumeResponse
    try {
      payload = await consumeShare(accessToken, current.token)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        expireSession()
        setPhase({ kind: 'idle' })
      } else if (err instanceof ApiError && err.status > 0 && err.status < 500) {
        setPhase({ kind: 'failed', message: errorMessage(err.code), canRetry: false })
      } else {
        // Response lost or server failed: the grant may have been consumed. Never retry automatically.
        setPhase({ kind: 'failed', message: UNCERTAIN_MESSAGE, canRetry: true })
      }
      return
    }
    if (payload.crypto_version !== current.version) {
      setPhase({ kind: 'decrypt_failed' })
      return
    }
    try {
      const plaintext = await decryptV1({ cek: current.cek, nonce: payload.nonce, ciphertext: payload.ciphertext })
      setPhase({ kind: 'revealed', plaintext })
    } catch {
      setPhase({ kind: 'decrypt_failed' })
    }
  }

  const loggedIn = getAccessToken() !== null
  const loginPrompt = <LoginPrompt message="Iniciá sesión con tu usuario para acceder al secreto." />

  return (
    <section>
      <h1>Secreto compartido</h1>

      {phase.kind === 'revealed' && (
        <>
          <label htmlFor="revealed">Secreto revelado</label>
          <textarea id="revealed" readOnly rows={6} value={phase.plaintext} />
          <CopyButton value={phase.plaintext} />
          <p className="hint">Guardalo en un lugar seguro: no vas a poder volver a verlo con este enlace.</p>
        </>
      )}

      {phase.kind === 'decrypt_failed' && (
        <p role="alert" className="error">
          {DECRYPT_FAILED_MESSAGE}
        </p>
      )}

      {phase.kind === 'failed' && (
        <>
          <p role="alert" className="error">
            {phase.message}
          </p>
          {phase.canRetry &&
            (loggedIn ? (
              <button type="button" onClick={() => void reveal(link)}>
                Intentar nuevamente
              </button>
            ) : (
              loginPrompt
            ))}
        </>
      )}

      {(phase.kind === 'idle' || phase.kind === 'consuming') &&
        (loggedIn ? (
          <div className="notice">
            <p>
              Ingresaste como <strong>{user?.profile.preferred_username}</strong>.
            </p>
            <p>
              Este secreto se puede obtener <strong>una sola vez</strong>. Al revelarlo, este enlace deja de funcionar
              para tu usuario.
            </p>
            <button type="button" onClick={() => void reveal(link)} disabled={phase.kind === 'consuming'}>
              {phase.kind === 'consuming' ? 'Obteniendo…' : 'Revelar secreto'}
            </button>
          </div>
        ) : (
          loginPrompt
        ))}
    </section>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/open
git commit -m "feat(frontend): open page with explicit one-time reveal and safe failure states

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 15: Admin page — paginated metadata table

**Model:** sonnet

**Files:**
- Create: `frontend/src/pages/admin/status.ts`
- Replace: `frontend/src/pages/admin/AdminPage.tsx`
- Test: `frontend/src/pages/admin/status.test.ts`, `frontend/src/pages/admin/AdminPage.test.tsx`

**Interfaces:**
- Consumes: `listAdminShares`, `AdminShareItem`, `AdminSharesPage`, `ApiError`, `useAuth`, `errorMessage`, `formatDateTime`, `TestAuthProvider`.
- Produces: `shareStatus(item: AdminShareItem, now: Date): string`; `AdminPage` with heading **"Administración"**, a table of metadata, and pagination buttons **"Anterior"** / **"Siguiente"**. A 403 shows `errorMessages.admin_access_required` ("No tenés permisos de administración.").

- [ ] **Step 1: Write failing tests**

`frontend/src/pages/admin/status.test.ts`:
```ts
import { describe, expect, it } from 'vitest'
import type { AdminShareItem } from '../../api'
import { shareStatus } from './status'

const NOW = new Date('2026-10-08T12:00:00Z')

function item(overrides: Partial<AdminShareItem> = {}): AdminShareItem {
  return {
    id: 'id',
    creator_identity: 'aperez',
    label: null,
    created_at: '2026-10-08T10:00:00Z',
    expires_at: '2026-10-08T13:00:00Z',
    revoked_at: null,
    payload_deleted_at: null,
    grants: [{ recipient_identity: 'bgonzalez', consumed_at: null }],
    ...overrides,
  }
}

describe('shareStatus', () => {
  it.each([
    ['Activo', item()],
    ['Vencido', item({ expires_at: '2026-10-08T11:59:59Z' })],
    ['Revocado', item({ revoked_at: '2026-10-08T11:00:00Z' })],
    ['Contenido eliminado', item({ payload_deleted_at: '2026-10-08T11:00:00Z', revoked_at: '2026-10-08T11:00:00Z' })],
    ['Obtenido por todos', item({ grants: [{ recipient_identity: 'bgonzalez', consumed_at: '2026-10-08T11:00:00Z' }] })],
  ])('derives %s', (expected, share) => {
    expect(shareStatus(share, NOW)).toBe(expected)
  })
})
```

`frontend/src/pages/admin/AdminPage.test.tsx`:
```tsx
// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../../api'
import { ApiError } from '../../api'
import { TestAuthProvider } from '../../test/auth'
import { AdminPage } from './AdminPage'

vi.mock('../../api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api')>()
  return { ...actual, listAdminShares: vi.fn() }
})

const listAdminShares = vi.mocked(api.listAdminShares)

const ITEM = {
  id: 'share-1',
  creator_identity: 'aperez',
  label: 'Staging DB',
  created_at: '2026-10-08T20:00:00Z',
  expires_at: '2999-01-01T00:00:00Z',
  revoked_at: null,
  payload_deleted_at: null,
  grants: [
    { recipient_identity: 'bgonzalez', consumed_at: '2026-10-08T20:05:00Z' },
    { recipient_identity: 'csaul', consumed_at: null },
  ],
}

function renderPage(onExpire = vi.fn()) {
  render(
    <TestAuthProvider initialToken="admin-token" username="flapinto" onExpire={onExpire}>
      <AdminPage />
    </TestAuthProvider>,
  )
  return { onExpire }
}

beforeEach(() => {
  listAdminShares.mockReset()
})

describe('AdminPage', () => {
  it('lists share metadata and grant states', async () => {
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 1, page_size: 50, total: 1 })
    renderPage()
    expect(await screen.findByText('Staging DB')).toBeInTheDocument()
    expect(screen.getByText('aperez')).toBeInTheDocument()
    expect(screen.getByText(/bgonzalez: obtenido/)).toBeInTheDocument()
    expect(screen.getByText(/csaul: pendiente/)).toBeInTheDocument()
    expect(screen.getByText('Activo')).toBeInTheDocument()
    expect(listAdminShares).toHaveBeenCalledWith('admin-token', 1, 50)
  })

  it('paginates', async () => {
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 1, page_size: 50, total: 120 })
    renderPage()
    await screen.findByText('Staging DB')
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled()
    listAdminShares.mockResolvedValue({ items: [ITEM], page: 2, page_size: 50, total: 120 })
    await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }))
    expect(listAdminShares).toHaveBeenLastCalledWith('admin-token', 2, 50)
    expect(await screen.findByText(/Página 2 de 3/)).toBeInTheDocument()
  })

  it('shows an empty state', async () => {
    listAdminShares.mockResolvedValue({ items: [], page: 1, page_size: 50, total: 0 })
    renderPage()
    expect(await screen.findByText('Todavía no se compartieron secretos.')).toBeInTheDocument()
  })

  it('explains a 403 in Spanish', async () => {
    listAdminShares.mockRejectedValue(new ApiError(403, 'admin_access_required'))
    renderPage()
    expect(await screen.findByRole('alert')).toHaveTextContent('No tenés permisos de administración.')
  })

  it('drops the session on 401', async () => {
    listAdminShares.mockRejectedValue(new ApiError(401, 'invalid_authentication'))
    const { onExpire } = renderPage()
    await vi.waitFor(() => expect(onExpire).toHaveBeenCalled())
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/admin`
Expected: FAIL.

- [ ] **Step 3: Implement**

`frontend/src/pages/admin/status.ts`:
```ts
import type { AdminShareItem } from '../../api'

export function shareStatus(item: AdminShareItem, now: Date): string {
  if (item.payload_deleted_at) return 'Contenido eliminado'
  if (item.revoked_at) return 'Revocado'
  if (new Date(item.expires_at) <= now) return 'Vencido'
  if (item.grants.length > 0 && item.grants.every((grant) => grant.consumed_at !== null)) return 'Obtenido por todos'
  return 'Activo'
}
```

Replace `frontend/src/pages/admin/AdminPage.tsx`:
```tsx
import { type ReactNode, useEffect, useState } from 'react'
import { type AdminSharesPage, ApiError, listAdminShares } from '../../api'
import { useAuth } from '../../auth/context'
import { formatDateTime } from '../../i18n/format'
import { errorMessage } from '../../i18n/messages'
import { shareStatus } from './status'

const PAGE_SIZE = 50

type Loaded =
  | { page: number; ok: true; data: AdminSharesPage; loadedAt: Date }
  | { page: number; ok: false; message: string }

export function AdminPage() {
  const { getAccessToken, expireSession } = useAuth()
  const [page, setPage] = useState(1)
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const accessToken = getAccessToken()

  useEffect(() => {
    if (accessToken === null) return
    let cancelled = false
    listAdminShares(accessToken, page, PAGE_SIZE).then(
      (data) => {
        if (!cancelled) setLoaded({ page, ok: true, data, loadedAt: new Date() })
      },
      (err: unknown) => {
        if (cancelled) return
        if (err instanceof ApiError && err.status === 401) {
          expireSession()
          return
        }
        setLoaded({ page, ok: false, message: errorMessage(err instanceof ApiError ? err.code : 'internal_error') })
      },
    )
    return () => {
      cancelled = true
    }
  }, [accessToken, page, expireSession])

  let content: ReactNode
  if (loaded === null || loaded.page !== page) {
    content = <p role="status">Cargando…</p>
  } else if (!loaded.ok) {
    content = (
      <p role="alert" className="error">
        {loaded.message}
      </p>
    )
  } else {
    content = <SharesTable data={loaded.data} now={loaded.loadedAt} onPageChange={setPage} />
  }

  return (
    <section>
      <h1>Administración</h1>
      <p className="hint">Solo metadatos de auditoría: el contenido de los secretos nunca es visible.</p>
      {content}
    </section>
  )
}

function SharesTable({
  data,
  now,
  onPageChange,
}: {
  data: AdminSharesPage
  now: Date
  onPageChange: (page: number) => void
}) {
  if (data.total === 0) return <p>Todavía no se compartieron secretos.</p>
  const totalPages = Math.max(1, Math.ceil(data.total / data.page_size))
  return (
    <>
      <table>
        <thead>
          <tr>
            <th>Creado</th>
            <th>Creador</th>
            <th>Etiqueta</th>
            <th>Vence</th>
            <th>Estado</th>
            <th>Destinatarios</th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((item) => (
            <tr key={item.id}>
              <td>{formatDateTime(item.created_at)}</td>
              <td>{item.creator_identity}</td>
              <td>{item.label ?? '—'}</td>
              <td>{formatDateTime(item.expires_at)}</td>
              <td>{shareStatus(item, now)}</td>
              <td>
                <ul>
                  {item.grants.map((grant) => (
                    <li key={grant.recipient_identity}>
                      {grant.recipient_identity}:{' '}
                      {grant.consumed_at ? `obtenido ${formatDateTime(grant.consumed_at)}` : 'pendiente'}
                    </li>
                  ))}
                </ul>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <nav aria-label="Paginación">
        <button type="button" disabled={data.page <= 1} onClick={() => onPageChange(data.page - 1)}>
          Anterior
        </button>{' '}
        <span>
          Página {data.page} de {totalPages} ({data.total} en total)
        </span>{' '}
        <button type="button" disabled={data.page >= totalPages} onClick={() => onPageChange(data.page + 1)}>
          Siguiente
        </button>
      </nav>
    </>
  )
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test && npm run build && npm run lint`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/admin
git commit -m "feat(frontend): paginated metadata-only admin page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---
## Milestone 4 — Integration, production-like stack, docs

### Task 16: Browser end-to-end tests against the dev stack and real Keycloak

**Model:** opus

**Files:**
- Create: `frontend/playwright.config.ts`, `frontend/e2e/support.ts`, `frontend/e2e/flows.spec.ts`
- Modify: `frontend/eslint.config.js` only if lint complains about `e2e/` (add it to ignores or give it a Node globals block)

**Interfaces:**
- Consumes: the UI strings listed in Tasks 12–15, the dev stack (Task 8), and the external Keycloak with the dev users from Global Constraints.
- Produces: Playwright projects `dev` (all specs except `smoke.spec.ts`) and `prod-smoke` (`smoke.spec.ts`, Task 17). `e2e/support.ts` exports `PASSWORDS`, `loginViaPopup(page, username)`, `newUserPage(browser, username)`, `openLinkAs(browser, username, link)`, `createShare(page, options): Promise<Record<string, string>>`, `fragmentParts(link): { t: string; k: string }`, `reveal(page)`.

- [ ] **Step 1: Install the browser and write the config**

Run (from `frontend/`): `npx playwright install chromium`

`frontend/playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list']],
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://app.localhost:3000',
    trace: 'retain-on-failure',
  },
  projects: [
    { name: 'dev', testIgnore: /smoke\.spec\.ts/ },
    { name: 'prod-smoke', testMatch: /smoke\.spec\.ts/ },
  ],
})
```

- [ ] **Step 2: Shared helpers**

`frontend/e2e/support.ts`:
```ts
import { type Browser, expect, type Page } from '@playwright/test'

/** Development-only Keycloak test users (password = lowercase first name). Never production credentials. */
export const PASSWORDS: Record<string, string> = {
  aperez: 'alicia',
  bgonzalez: 'boberto',
  csaul: 'carlitos',
  dlopez: 'daniel',
  efuseneco: 'elena',
  flapinto: 'franco',
}

/** Clicks "Iniciar sesión", completes the Keycloak popup if it asks for credentials, waits for the session. */
export async function loginViaPopup(page: Page, username: string): Promise<void> {
  const popupPromise = page.waitForEvent('popup')
  await page.getByRole('button', { name: 'Iniciar sesión' }).first().click()
  const popup = await popupPromise
  const closed = popup.waitForEvent('close')
  // With an existing Keycloak SSO cookie the popup completes and closes on its own.
  const needsForm = await Promise.race([
    popup
      .locator('#username')
      .waitFor({ timeout: 20_000 })
      .then(
        () => true,
        () => false,
      ),
    closed.then(() => false),
  ])
  if (needsForm) {
    await popup.locator('#username').fill(username)
    await popup.locator('#password').fill(PASSWORDS[username])
    await popup.locator('#kc-login').click()
    await closed
  }
  await expect(page.getByText(`Sesión: ${username}`)).toBeVisible()
}

export async function newUserPage(browser: Browser, username: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto('/')
  await loginViaPopup(page, username)
  return page
}

/** Fresh browser context (fresh tab memory), opens the link, logs in. Does NOT click reveal. */
export async function openLinkAs(browser: Browser, username: string, link: string): Promise<Page> {
  const context = await browser.newContext()
  const page = await context.newPage()
  await page.goto(link)
  await loginViaPopup(page, username)
  return page
}

export interface CreateOptions {
  plaintext: string
  recipients: string[]
  label: string
  shared?: boolean
}

export async function createShare(page: Page, options: CreateOptions): Promise<Record<string, string>> {
  await page.getByLabel('Secreto', { exact: true }).fill(options.plaintext)
  await page.getByLabel('Destinatarios').fill(options.recipients.join(', '))
  await page.getByLabel('Etiqueta (opcional)').fill(options.label)
  if (options.shared) await page.getByLabel('Usar un único enlace para todos los destinatarios').check()
  await page.getByRole('button', { name: 'Cifrar y crear enlaces' }).click()
  const list = page.getByTestId('share-links')
  await expect(list).toBeVisible()
  const links: Record<string, string> = {}
  for (const recipient of options.recipients) {
    links[recipient] = ((await list.locator(`li[data-recipient="${recipient}"] code`).textContent()) ?? '').trim()
  }
  return links
}

export function fragmentParts(link: string): { t: string; k: string } {
  const params = new Map(new URL(link).hash.slice(1).split('&').map((p) => p.split('=') as [string, string]))
  return { t: params.get('t') ?? '', k: params.get('k') ?? '' }
}

export async function reveal(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Revelar secreto' }).click()
}
```

- [ ] **Step 3: Write the flows**

`frontend/e2e/flows.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { createShare, fragmentParts, loginViaPopup, newUserPage, openLinkAs, reveal } from './support'

const LINK_SHAPE = /^http:\/\/app\.localhost:3000\/s#v=1&t=[A-Za-z0-9_-]{43}&k=[A-Za-z0-9_-]{43}$/
const unique = (prefix: string) => `${prefix} ${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

test('individual links: each recipient reveals exactly once', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = `${unique('db-pass')} ñandú 🔐`
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez', 'csaul'], label: unique('e2e individual') })
  expect(links.bgonzalez).toMatch(LINK_SHAPE)
  expect(links.bgonzalez).not.toBe(links.csaul)

  for (const recipient of ['bgonzalez', 'csaul']) {
    const page = await openLinkAs(browser, recipient, links[recipient])
    await reveal(page)
    await expect(page.getByLabel('Secreto revelado')).toHaveValue(secret)

    await page.reload()
    await loginViaPopup(page, recipient)
    await reveal(page)
    await expect(page.getByRole('alert')).toContainText('Este secreto ya fue obtenido')
  }
})

test('shared link: same URL, independent one-time grants', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = unique('shared-secret')
  const links = await createShare(sender, {
    plaintext: secret,
    recipients: ['bgonzalez', 'csaul'],
    label: unique('e2e shared'),
    shared: true,
  })
  expect(links.bgonzalez).toBe(links.csaul)
  for (const recipient of ['bgonzalez', 'csaul']) {
    const page = await openLinkAs(browser, recipient, links[recipient])
    await reveal(page)
    await expect(page.getByLabel('Secreto revelado')).toHaveValue(secret)
  }
  const outsider = await openLinkAs(browser, 'dlopez', links.bgonzalez)
  await reveal(outsider)
  await expect(outsider.getByRole('alert')).toContainText('no está destinado a tu usuario')
})

test('wrong user gets 404 and does not consume the rightful grant', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const secret = unique('wrong-user')
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label: unique('e2e wrong user') })

  const intruder = await openLinkAs(browser, 'csaul', links.bgonzalez)
  await reveal(intruder)
  await expect(intruder.getByRole('alert')).toContainText('no está destinado a tu usuario')

  const rightful = await openLinkAs(browser, 'bgonzalez', links.bgonzalez)
  await reveal(rightful)
  await expect(rightful.getByLabel('Secreto revelado')).toHaveValue(secret)
})

test('tampered key: grant is consumed once and decryption fails locally', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const links = await createShare(sender, { plaintext: unique('tamper'), recipients: ['bgonzalez'], label: unique('e2e tamper') })
  const { k } = fragmentParts(links.bgonzalez)
  const replacement = k[0] === 'A' ? 'B' : 'A' // changing the first char keeps a valid 32-byte key
  const tampered = links.bgonzalez.replace(`k=${k}`, `k=${replacement}${k.slice(1)}`)

  const page = await openLinkAs(browser, 'bgonzalez', tampered)
  await reveal(page)
  await expect(page.getByRole('alert')).toContainText('ya fue consumido')

  const again = await openLinkAs(browser, 'bgonzalez', links.bgonzalez)
  await reveal(again)
  await expect(again.getByRole('alert')).toContainText('Este secreto ya fue obtenido')
})

test('login never auto-consumes; token and key never leave the fragment or reach Keycloak', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const links = await createShare(sender, { plaintext: unique('leak-check'), recipients: ['bgonzalez'], label: unique('e2e leak') })
  const { t, k } = fragmentParts(links.bgonzalez)

  const context = await browser.newContext()
  const seen: { url: string; body: string }[] = []
  context.on('request', (request) => seen.push({ url: request.url(), body: request.postData() ?? '' }))
  const page = await context.newPage()
  await page.goto(links.bgonzalez)
  await loginViaPopup(page, 'bgonzalez')

  const isConsume = (url: string) => url.includes('/api/v1/access/consume')
  expect(seen.filter((r) => isConsume(r.url))).toHaveLength(0)

  // Memory-only OIDC: nothing persisted in web storage after a real Keycloak login.
  expect(await page.evaluate(() => localStorage.length + sessionStorage.length)).toBe(0)

  await reveal(page)
  await expect(page.getByLabel('Secreto revelado')).toBeVisible()
  expect(seen.filter((r) => isConsume(r.url))).toHaveLength(1)
  for (const request of seen) {
    expect(request.url).not.toContain(t)
    expect(request.url).not.toContain(k)
    expect(request.body).not.toContain(k)
    if (!isConsume(request.url)) expect(request.body).not.toContain(t)
  }
})

test('malformed link shows an error and never calls the API', async ({ page }) => {
  const calls: string[] = []
  page.on('request', (request) => {
    if (request.url().includes('/api/')) calls.push(request.url())
  })
  await page.goto('/s#v=1&t=abc&k=def')
  await expect(page.getByRole('alert')).toContainText('El enlace está incompleto o no es válido')
  expect(calls).toHaveLength(0)
})

test('admin sees metadata only; non-admin is refused', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const label = unique('e2e admin')
  const secret = unique('admin-secret')
  await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label })

  const admin = await newUserPage(browser, 'flapinto')
  const responsePromise = admin.waitForResponse((r) => r.url().includes('/api/v1/admin/shares'))
  await admin.getByRole('link', { name: 'Administración' }).click()
  const body = await (await responsePromise).json()
  const item = body.items.find((i: { label: string }) => i.label === label)
  expect(Object.keys(item).sort()).toEqual(
    ['created_at', 'creator_identity', 'expires_at', 'grants', 'id', 'label', 'payload_deleted_at', 'revoked_at'].sort(),
  )
  expect(JSON.stringify(body)).not.toMatch(/ciphertext|nonce|access_token/)
  expect(JSON.stringify(body)).not.toContain(secret)
  await expect(admin.getByText(label)).toBeVisible()

  const other = await newUserPage(browser, 'dlopez')
  await other.getByRole('link', { name: 'Administración' }).click()
  await expect(other.getByRole('alert')).toContainText('No tenés permisos de administración.')
})

test('MAX_PLAINTEXT_BYTES is enforced by the UI and a max-size secret is accepted by the backend', async ({ browser }) => {
  const max = Number(process.env.MAX_PLAINTEXT_BYTES ?? 65536)
  const page = await newUserPage(browser, 'aperez')
  await page.getByLabel('Secreto', { exact: true }).fill('a'.repeat(max + 1))
  await expect(page.getByText(/supera el tamaño máximo/)).toBeVisible()
  await expect(page.getByRole('button', { name: 'Cifrar y crear enlaces' })).toBeDisabled()

  const links = await createShare(page, { plaintext: 'a'.repeat(max), recipients: ['bgonzalez'], label: unique('e2e max') })
  expect(links.bgonzalez).toMatch(LINK_SHAPE)
})

test('dev server hot reload websocket connects through the proxy', async ({ page }) => {
  const sockets: string[] = []
  page.on('websocket', (ws) => sockets.push(ws.url()))
  await page.goto('/')
  await expect.poll(() => sockets.some((url) => url.startsWith('ws://app.localhost:3000'))).toBe(true)
})

test('no CSP violations during a full dev flow', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const violations: string[] = []
  sender.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  await createShare(sender, { plaintext: unique('csp'), recipients: ['bgonzalez'], label: unique('e2e csp') })
  expect(violations).toEqual([])
})
```

- [ ] **Step 4: Run against the live dev stack**

Run (from `tp_final/`): `docker compose up -d` and wait until `curl -s -o /dev/null -w '%{http_code}' http://app.localhost:3000/` prints `200`.
Run (from `frontend/`): `npm run e2e`
Expected: all tests PASS. Failures here are real integration bugs. Debug them with superpowers:systematic-debugging; the Playwright traces are in `test-results/`. If the Keycloak login page uses different element ids than `#username` / `#password` / `#kc-login`, update `loginViaPopup`. If Keycloak itself misbehaves (e.g. it rejects the redirect URI), **stop and report to the user**: the local Keycloak is theirs to fix.

- [ ] **Step 5: Commit**

```bash
git add frontend/playwright.config.ts frontend/e2e/support.ts frontend/e2e/flows.spec.ts
git commit -m "test(e2e): Playwright flows against the dev stack and real Keycloak

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Also stage `frontend/eslint.config.js` if you changed it.)

---

### Task 17: Production-like stack — static build behind strict CSP, plus smoke test

**Model:** opus

**Files:**
- Create: `frontend/Dockerfile`, `.dockerignore`, `infra/caddy/Caddyfile.prod`, `compose.prod.yaml`, `frontend/e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: backend image (Task 8), frontend build, `.env`, e2e helpers (Task 16).
- Produces: `docker compose -f compose.prod.yaml up -d --build` serves the built bundle and API at `http://app.localhost:3000` with the exact base-spec §27 headers. Playwright project `prod-smoke`.

- [ ] **Step 1: Build and serve files**

`.dockerignore` (at `tp_final/`, the build context of the web image):
```
**/node_modules
**/.venv
**/dist
**/test-results
**/playwright-report
**/__pycache__
.env
.git
```

`frontend/Dockerfile`:
```dockerfile
# Build context: tp_final/ (needs both frontend/ and infra/caddy/).
FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
# Baked into the static bundle at build time (base spec §19).
ARG VITE_MAX_PLAINTEXT_BYTES
ARG VITE_OIDC_ISSUER
ARG VITE_OIDC_CLIENT_ID
RUN npm run build

FROM caddy:2-alpine
COPY infra/caddy/Caddyfile.prod /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv
```

`infra/caddy/Caddyfile.prod`:
```caddyfile
{
	auto_https off
	admin off
}

# Local production-like smoke test over HTTP on *.localhost.
# In production, TLS terminates at the corporate gateway or here (operator-provisioned certificate); see README.
http://:3000 {
	header {
		defer
		Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' {$OIDC_ORIGIN}; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'"
		Referrer-Policy "no-referrer"
		X-Content-Type-Options "nosniff"
		Cache-Control "no-store"
	}

	handle /api/* {
		request_body {
			max_size 256KB
		}
		reverse_proxy backend:8000
	}

	handle {
		root * /srv
		try_files {path} /index.html
		file_server
	}
}
```

`compose.prod.yaml`:
```yaml
# Production-like local smoke stack. Run it instead of (not alongside) compose.yaml: both use port 3000.
name: chismoso-prod

services:
  db:
    image: postgres:18-alpine
    env_file: .env
    volumes:
      - db-data:/var/lib/postgresql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U $${POSTGRES_USER} -d $${POSTGRES_DB}"]
      interval: 2s
      timeout: 3s
      retries: 30

  backend:
    build: ./backend
    env_file: .env
    depends_on:
      db:
        condition: service_healthy
    # The IdP network is only needed because the local Keycloak is reached over Docker.
    # Real deployments drop it and leave OIDC_JWKS_URL empty.
    networks: [default, idp]

  web:
    build:
      context: .
      dockerfile: frontend/Dockerfile
      args:
        VITE_MAX_PLAINTEXT_BYTES: ${MAX_PLAINTEXT_BYTES}
        VITE_OIDC_ISSUER: ${OIDC_ISSUER}
        VITE_OIDC_CLIENT_ID: ${OIDC_CLIENT_ID}
    environment:
      OIDC_ORIGIN: ${OIDC_ORIGIN}
    ports:
      - "127.0.0.1:3000:3000"
    depends_on: [backend]

networks:
  idp:
    external: true
    name: ${IDP_DOCKER_NETWORK:-chismoso-idp_default}

volumes:
  db-data:
```

- [ ] **Step 2: Smoke spec**

`frontend/e2e/smoke.spec.ts`:
```ts
import { expect, test } from '@playwright/test'
import { createShare, newUserPage, openLinkAs, reveal } from './support'

test('serves the static bundle with the strict production headers', async ({ request }) => {
  const response = await request.get('/')
  expect(response.status()).toBe(200)
  const csp = response.headers()['content-security-policy']
  expect(csp).toContain("script-src 'self';")
  expect(csp).toContain("style-src 'self';")
  expect(csp).toContain("frame-ancestors 'none'")
  expect(csp).not.toContain('unsafe-inline')
  expect(response.headers()['referrer-policy']).toBe('no-referrer')
  expect(response.headers()['x-content-type-options']).toBe('nosniff')
  expect(response.headers()['cache-control']).toBe('no-store')
  expect(await response.text()).not.toContain('/@vite/client')

  const deepLink = await request.get('/admin')
  expect(deepLink.status()).toBe(200)
})

test('create and reveal work under the strict CSP with no violations', async ({ browser }) => {
  const sender = await newUserPage(browser, 'aperez')
  const violations: string[] = []
  sender.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  const secret = `smoke ${Date.now()} ñ`
  const links = await createShare(sender, { plaintext: secret, recipients: ['bgonzalez'], label: `smoke ${Date.now()}` })

  const recipient = await openLinkAs(browser, 'bgonzalez', links.bgonzalez)
  recipient.on('console', (message) => {
    if (message.text().includes('Content Security Policy')) violations.push(message.text())
  })
  await reveal(recipient)
  await expect(recipient.getByLabel('Secreto revelado')).toHaveValue(secret)
  expect(violations).toEqual([])
})
```

- [ ] **Step 3: Run the prod-like stack and smoke test**

Run (from `tp_final/`):
```bash
docker compose down
docker compose -f compose.prod.yaml up -d --build
```
Wait until `curl -s -o /dev/null -w '%{http_code}' http://app.localhost:3000/` prints `200`, then run (from `frontend/`): `npm run e2e:smoke`
Expected: PASS. If a CSP violation appears, find what the built bundle does inline (`grep -n '<script\|<style' dist/index.html` after `npm run build`) and fix the build. Do not loosen the CSP.

Then restore the dev stack: `docker compose -f compose.prod.yaml down && docker compose up -d`

- [ ] **Step 4: Commit**

```bash
git add frontend/Dockerfile .dockerignore infra/caddy/Caddyfile.prod compose.prod.yaml frontend/e2e/smoke.spec.ts
git commit -m "feat(infra): production-like static build behind strict CSP with smoke test

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 18: README and operator documentation

**Model:** sonnet

**Files:**
- Create: `README.md` (in `tp_final/`)

**Interfaces:**
- Consumes: everything above. Every command written in the README must be one you actually ran in this task.

- [ ] **Step 1: Write `tp_final/README.md`**

Required sections, all in English, each with exact commands:
1. **What Chismoso is.** One paragraph, plus the security model in 5 bullets: client-side AES-256-GCM, fragment-only token and key, one-time per recipient, metadata-only admin, and the accepted risks pointer (base spec §31).
2. **Architecture.** A text diagram: browser ↔ Caddy (`/api/*` → FastAPI → PostgreSQL; everything else → Vite or static files); browser ↔ Keycloak popup; backend → Keycloak JWKS. Then the repo layout.
3. **Prerequisites.** Docker + Compose, uv, Node 22, and the separately operated Keycloak at `http://idp.localhost:8080/realms/chismoso` (its Docker network `chismoso-idp_default`).
4. **Run locally.** `cp .env.example .env`, `docker compose up -d --build`, open `http://app.localhost:3000`, and the dev users (password = lowercase first name; `flapinto` is admin).
5. **Tests.** Backend: `docker compose up -d db` then `cd backend && uv run pytest`. Frontend unit: `cd frontend && npm test`. E2E: dev stack up, then `npx playwright install chromium` (first time) and `npm run e2e`. Prod smoke: the Task 17 command sequence. Regenerate crypto vectors: `cd backend && uv run python -m scripts.gen_crypto_vectors`.
6. **Configuration.** A table of every `.env.example` variable: purpose, which component reads it, and dev vs production value. Call out that `OIDC_JWKS_URL` is empty in production, that `MAX_PLAINTEXT_BYTES` requires a frontend rebuild, and that `MAX_CIPHERTEXT_BYTES` must be ≥ `MAX_PLAINTEXT_BYTES + 16`.
7. **Production notes.** The browser origin must be a secure context (HTTPS with a certificate trusted by clients). TLS terminates at the corporate gateway or at Caddy (operator provisions certificates; no in-app PKI). Use `compose.prod.yaml` as the template, minus the `idp` network. Keycloak needs the production redirect URI `https://<host>/*` and the matching web origin. `OIDC_ORIGIN` must be the production IdP origin for the CSP. Backend logs contain only method, route template, status and latency.
8. **Design decisions.** Short bullets linking `chismoso_spec_v1_1_reconciled.md` and `docs/superpowers/specs/2026-10-08-chismoso-mvp-design.md`; list the gap decisions G1–G9.
9. **Post-MVP.** Pointer to base spec §24, plus the planned UI polish cycle.

- [ ] **Step 2: Verify the README's commands**

From a clean shell, run the "Run locally" and "Tests" commands exactly as written (backend tests, frontend unit tests, `npm run e2e`). Expected: all succeed. Fix the README wherever a command differs from reality.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: README with local setup, tests, configuration and production notes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Final verification (controller, after Task 18)

- [ ] `cd backend && uv run pytest -q`: all pass.
- [ ] `cd frontend && npm test && npm run build && npm run lint`: all pass.
- [ ] Dev stack up, then `cd frontend && npm run e2e`: all pass.
- [ ] Prod-like stack up, then `npm run e2e:smoke`: pass. Restore the dev stack afterwards.
- [ ] `git grep -nE "alicia|boberto|carlitos|franco" -- ':!frontend/e2e' ':!docs' ':!README.md'` returns nothing (dev passwords only in e2e code and docs).
- [ ] Whole-branch code review (superpowers:requesting-code-review), then superpowers:finishing-a-development-branch.
- [ ] Afterwards: milestone 5 (UI/UX polish) starts as a **new** brainstorm → spec → plan cycle.
