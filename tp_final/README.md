# Chismoso

Chismoso is a one-time secret handoff service for an organization. An authenticated sender types a secret in the browser, the browser encrypts it, and the service stores only the ciphertext. The sender gets back one link per recipient (or one shared link for several recipients). Each authorized recipient logs in, explicitly reveals the secret once, and the browser decrypts it locally. Identity comes from an existing Keycloak realm; there is no local users table. The UI is in Spanish (Rioplatense), the code and docs are in English.

Security model:

- **Client-side encryption.** The browser generates a fresh AES-256-GCM key per share and encrypts with WebCrypto. The server never sees plaintext or the key.
- **Fragment-only token and key.** The share link is `/s#...`. The access token and the key live only in the URL fragment, so they are never sent in an HTTP request line, a proxy log or a `Referer`. The server stores only a SHA-256 digest of the token.
- **One-time, per recipient.** Every recipient has an independent grant, consumed atomically by an explicit click (a `GET` or a login never consumes). A second attempt gets `410`; a user who is not a recipient gets `404`.
- **Metadata-only admin.** The admin backoffice (`/admin`, Keycloak client role `chismoso-admin`) lists senders, recipients, labels and timestamps. It never exposes ciphertext, nonce, token digests or keys.
- **Accepted risks.** A compromised frontend bundle, a compromised IdP or a compromised recipient device are out of scope; see base spec section 31 in [`chismoso_spec_v1_1_reconciled.md`](chismoso_spec_v1_1_reconciled.md).

## Architecture

```
                      +--------------------------- Caddy (proxy / web) ---------------------------+
 Browser  <-- HTTP -->|  /api/*  --> FastAPI backend (:8000) --> PostgreSQL                        |
 (WebCrypto,          |  other   --> dev: Vite dev server (:5173, HMR)                             |
  app.localhost:3000) |            prod-like: static bundle from /srv                              |
    |                 +----------------------------------------------------------------------------+
    |  OIDC popup (authorization code + PKCE)                                    |
    +------------------------> Keycloak (separate stack, idp.localhost:8080)  <--+ backend fetches JWKS
                                                                                   (validates JWT iss/aud/signature)
```

Repository layout (`tp_final/`):

```
backend/            FastAPI app (app/), Alembic migrations (migrations/), pytest suite (tests/),
                    crypto vector generator (scripts/)
frontend/           React + Vite SPA (src/), unit tests next to the code, Playwright e2e (e2e/)
infra/caddy/        Caddyfile.dev (proxy to Vite, relaxed dev CSP) and Caddyfile.prod (static files, strict CSP)
infra/postgres/     init script that creates the chismoso_test database for host-run backend tests
compose.yaml        dev stack: db, backend (--reload), frontend (Vite), proxy
compose.prod.yaml   production-like stack: db, backend, web (static build + Caddy)
docs/superpowers/   design spec with the MVP gap decisions
chismoso_spec_v1_1_reconciled.md   base spec (normative)
```

Stack: Python 3.14, FastAPI, SQLAlchemy 2, PyJWT, Alembic, PostgreSQL 18; React 19, Vite 8, TypeScript ~6.0, react-router 8, oidc-client-ts 3.5, Tailwind CSS 4, shadcn/ui (Radix), oxlint, Vitest 5, Playwright.

## Prerequisites

- Docker with Compose v2.
- [uv](https://docs.astral.sh/uv/) (backend tests; it provisions Python 3.14).
- Node 22 and npm (frontend unit tests and e2e on the host).
- The separately operated Keycloak, reachable from the browser at `http://idp.localhost:8080/realms/chismoso` and attached to the Docker network `chismoso-idp_default` under the host name `keycloak`. This repository does not start or configure it. The dev defaults assume the client `chismoso`, the API audience `chismoso-api` and the client role `chismoso-admin` (see Configuration).

## Run locally

```bash
cd tp_final
cp .env.example .env
docker compose up -d --build
```

Open `http://app.localhost:3000`. Plain HTTP is intentional: `*.localhost` is a secure context, so WebCrypto works without a local CA. The first start runs `npm ci` inside the frontend container and the backend applies the Alembic migrations, so give it a few seconds; `/api` answers 502 until the backend is up.

Dev users (password = lowercase first name; only `flapinto` is an admin):

| User | Password |
| --- | --- |
| `aperez` | `alicia` |
| `bgonzalez` | `boberto` |
| `csaul` | `carlitos` |
| `dlopez` | `daniel` |
| `efuseneco` | `elena` |
| `flapinto` (admin) | `franco` |

Typical flow: log in as `aperez` on `/`, create a share for `bgonzalez`, copy the link, open it in another browser profile, log in as `bgonzalez` and click the reveal button. Tokens are kept in memory only, so reloading a page requires one more click on the login button. The login popup is mandatory: closing it shows an error and the page stays usable.

Stop with `docker compose down`. `docker compose down -v` additionally deletes this dev project's (`chismoso`) volumes: `chismoso_db-data`, which holds both the dev database and `chismoso_test`, and `chismoso_frontend-node-modules`. Use it only to start from scratch.

## Tests

Backend (needs the `db` service, which publishes Postgres on `127.0.0.1:5433` and creates the `chismoso_test` database):

```bash
docker compose up -d db
cd backend && uv run pytest
```

Frontend unit tests, type check/build and lint:

```bash
cd frontend
npm ci            # first time on the host
npm test
npm run build
npm run lint
npm run csp-check   # production build under the exact prod CSP; fails on any violation
```

`csp-check` builds the app, serves it with the CSP from `infra/caddy/Caddyfile.prod` and loads every route in headless Chromium (needs `npx playwright install chromium` once). The dev stack cannot catch these violations: Vite injects CSS as `<style>` tags, so the dev proxy allows inline styles. Run it after adding a UI dependency or touching styles. Besides the real routes it loads `/_estados`, a dev-only page that renders every page state with fake data (logged-in forms, created links, revealed secret, admin table); it also works as a review page at `http://app.localhost:3000/_estados`. The production build leaves it out.

Browser e2e against the running dev stack and the real Keycloak (12 tests: create/consume flows in individual and shared modes, wrong user, tampered key, no auto-consume, malformed link, admin, size limit, HMR WebSocket through the proxy, full-flow CSP check, copy-link, closing the login popup):

```bash
cd frontend
npx playwright install chromium   # first time only
npm run e2e
```

Production-like smoke test (2 tests: strict headers and a create/reveal flow with no CSP violations). The dev and prod-like stacks both bind `127.0.0.1:3000`, so run one at a time. Do not add `-v` to the first `docker compose down`: that would delete the dev project's `chismoso_db-data` volume. The prod-like stack is a separate Compose project (`chismoso-prod`) with its own `chismoso-prod_db-data` volume, which is all that `-v` on its `down` would delete:

```bash
docker compose down
docker compose -f compose.prod.yaml up -d --build
(cd frontend && npm run e2e:smoke)
docker compose -f compose.prod.yaml down
docker compose up -d        # back to the dev stack
```

Wait until `curl -s -o /dev/null -w '%{http_code}' http://app.localhost:3000/api/v1/admin/shares` prints `401` before running the smoke test (502 means the backend is still starting).

Regenerate the cross-client crypto known-answer vectors (`frontend/src/crypto/__fixtures__/v1-vectors.json`, checked by both the backend and frontend suites; the output is deterministic):

```bash
cd backend && uv run python -m scripts.gen_crypto_vectors
```

## Configuration

One variable schema serves development and production (`.env.example`; `.env` is gitignored). `compose.yaml` and `compose.prod.yaml` pass `.env` to the containers and map three values into the frontend build as `VITE_*`.

| Variable | Purpose | Read by | Dev value | Production |
| --- | --- | --- | --- | --- |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | Database credentials and name | `db` container | `chismoso` / `chismoso` / `chismoso` | Strong secret password |
| `DATABASE_URL` | SQLAlchemy URL of the application database | backend | `postgresql+psycopg://chismoso:chismoso@db:5432/chismoso` | Same shape with production credentials and host |
| `OIDC_ISSUER` | Canonical Keycloak issuer; the JWT `iss` must equal it exactly | backend, frontend build (`VITE_OIDC_ISSUER`) | `http://idp.localhost:8080/realms/chismoso` | Production realm URL |
| `OIDC_ORIGIN` | Origin of the IdP, inserted into the CSP `connect-src` | Caddy | `http://idp.localhost:8080` | Production IdP origin (scheme + host + port only) |
| `OIDC_CLIENT_ID` | OIDC public client used by the SPA | frontend build (`VITE_OIDC_CLIENT_ID`) | `chismoso` | Production client id |
| `OIDC_EXPECTED_AUDIENCE` | Required JWT `aud` | backend | `chismoso-api` | Same, per realm |
| `OIDC_ADMIN_CLIENT_ID` | Keycloak client whose roles are checked for admin | backend | `chismoso` | Same, per realm |
| `OIDC_ADMIN_ROLE` | Client role that grants `/admin` | backend | `chismoso-admin` | Same, per realm |
| `OIDC_JWKS_URL` | Optional alternative address for fetching signing keys (transport only; `iss` is still checked against `OIDC_ISSUER`) | backend | `http://keycloak:8080/realms/chismoso/protocol/openid-connect/certs` | **Empty.** Keys are then fetched from `${OIDC_ISSUER}/protocol/openid-connect/certs` |
| `IDP_DOCKER_NETWORK` | External Docker network of the local Keycloak stack | local compose files only | `chismoso-idp_default` | Unused (drop the network) |
| `MIN_EXPIRES_IN_MINUTES`, `MAX_EXPIRES_IN_MINUTES` | Allowed share lifetime | backend | `10`, `43200` (30 days) | Policy choice |
| `MAX_RECIPIENTS_PER_SHARE` | Recipients per share | backend | `100` | Policy choice |
| `MAX_LABEL_LENGTH` | Label length in characters | backend | `256` | Policy choice |
| `MAX_PLAINTEXT_BYTES` | Secret size limit in UTF-8 **bytes**, enforced by the UI | frontend build (`VITE_MAX_PLAINTEXT_BYTES`) | `65536` | Policy choice. **Changing it requires rebuilding the frontend** (`docker compose -f compose.prod.yaml up -d --build`; the dev container needs a restart) |
| `MAX_CIPHERTEXT_BYTES` | Ciphertext ceiling enforced by the API | backend | `65552` | Must be `>= MAX_PLAINTEXT_BYTES + 16` (the AES-GCM tag), otherwise a maximum-size secret is rejected |
| `MAX_NONCE_BYTES` | Nonce size ceiling | backend | `256` | Keep |
| `MAX_ADMIN_PAGE_SIZE` | Maximum admin page size | backend | `100` | Policy choice |

Caddy additionally caps API request bodies at 256 KB.

## Production notes

- **Secure context is mandatory.** WebCrypto and the clipboard API need a secure context, so the browser origin must be HTTPS with a certificate the clients trust. The app shows an explanatory message on insecure origins instead of failing silently. Plain HTTP works only on `*.localhost`.
- **TLS.** Terminate it at the corporate gateway, or at Caddy (replace the `http://:3000` site and `auto_https off` in `infra/caddy/Caddyfile.prod`, mount the certificate, and publish port 443 on a non-loopback interface; `compose.prod.yaml` publishes only `127.0.0.1:3000`). The operator provisions the certificates; there is no in-app PKI.
- **Compose.** Use `compose.prod.yaml` as the template, minus the `idp` network (and its `networks:` entries), and with `OIDC_JWKS_URL` empty. Set real database credentials and provide your own persistence and backups for the `db-data` volume.
- **Keycloak.** The client needs the production redirect URI `https://<host>/*` and the matching web origin. The access token must carry the audience `OIDC_EXPECTED_AUDIENCE` and the admin role under the client `OIDC_ADMIN_CLIENT_ID`.
- **CSP.** `OIDC_ORIGIN` must be the production IdP origin; the production CSP has no `unsafe-inline` and no `ws:`.
- **Sessions.** Access tokens are used from memory only and there is no silent renew. When a token expires the UI asks for a new login and keeps what the user typed. "Cerrar sesión" only clears this tab's in-memory session: the Keycloak SSO session remains, so the next login may complete in one click without a password.
- **Logs.** Backend logs contain only method, route template, status and latency, plus the exception type for unhandled errors. They never contain tokens, keys, bodies, query strings or full URLs.

## Design decisions

The base spec ([`chismoso_spec_v1_1_reconciled.md`](chismoso_spec_v1_1_reconciled.md)) is normative; [`docs/superpowers/specs/2026-10-08-chismoso-mvp-design.md`](docs/superpowers/specs/2026-10-08-chismoso-mvp-design.md) records the gaps it left open:

- **G1** Routes: `/` create, `/s` open/consume, `/admin` backoffice, `/auth/callback` OIDC popup callback.
- **G2** Every page requires login, always through the popup flow; no redirect flow.
- **G3** `MAX_PLAINTEXT_BYTES`, `OIDC_ISSUER` and `OIDC_CLIENT_ID` are defined once in `.env` and passed to Vite as `VITE_*` (container env in dev, build args in prod).
- **G4** The backend reaches Keycloak over the external Docker network via the optional `OIDC_JWKS_URL`; `iss` is still validated against `OIDC_ISSUER`.
- **G5** Usernames are trimmed and lowercased, anything containing `@` is rejected, then they must match `^[a-z0-9][a-z0-9._-]{0,63}$`.
- **G6** The database is published on `127.0.0.1:5433` because 5432 was taken.
- **G7** Dev-user passwords live only in the e2e fixture, never in application config.
- **G8** Reverse proxy: Caddy.
- **G9** JWT validation: PyJWT with a cached `PyJWKClient`.

## Post-MVP

The backlog and explicit exclusions are in base spec section 24: encrypted-payload cleanup worker, a creator's own share list, admin audit UX, creator revocation, service-account access, rate limiting and more. None of it is implemented. A UI/UX polish pass is planned as a separate cycle (new brainstorm, spec and plan) now that the MVP is complete and tested.

## Presentation

`slides/` holds a short reveal.js deck (in Spanish) for presenting the project. It is self-contained and shares no code or config with the app:

```bash
cd slides
npm install
npm run dev        # http://127.0.0.1:4300 (fixed port, so it can run next to the app stack)
```

Arrow keys advance, `S` opens the speaker view with notes and `F` goes fullscreen. See [`slides/README.md`](slides/README.md).
