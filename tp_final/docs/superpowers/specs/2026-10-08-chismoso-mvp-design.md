# Chismoso MVP — Design (gap resolutions and architecture)

**Date:** 2026-10-08
**Status:** approved in conversation; pending written-spec review
**Normative base:** [`tp_final/chismoso_spec_v1_1_reconciled.md`](../../../chismoso_spec_v1_1_reconciled.md) ("the base spec").

This document does **not** restate the base spec. The base spec remains authoritative for every rule it states (crypto protocol, API contracts, lock ordering, error codes, invariants, tests). This document records (a) decisions that close gaps the base spec left open and (b) the concrete architecture and build order. Where the two conflict, the base spec wins unless this document explicitly says it overrides a point, and none currently do.

## 1. Intended outcome

A fully working, tested Chismoso MVP in `tp_final/`, runnable locally at `http://app.localhost:3000` against the developer's pre-existing Keycloak (`http://idp.localhost:8080/realms/chismoso`). This is the final assignment (TP final) for IISAIA; the process is captured by exporting the Claude Code session, so no prompt log is required, but the repo gets a README and supporting docs.

Success criteria:

1. Every executable test required by base spec §30 exists and passes (backend, frontend unit, browser e2e, prod-like smoke).
2. End-to-end flow verified in a real browser through the reverse proxy with the real Keycloak: create → copy link → recipient login → explicit consume → local decrypt.
3. The frontend is **basic but complete** first. A UI/UX polish pass is a separate later cycle that starts only after everything else works.

## 2. Gap decisions

| # | Gap in base spec | Decision |
|---|---|---|
| G1 | Frontend route names | `/` = create, `/s` = open/consume, `/admin` = admin backoffice, `/auth/callback` = OIDC popup callback. |
| G2 | Which pages require login | **All** interactions require authentication. All pages use the same popup OIDC flow (base §18); no redirect flow is built. |
| G3 | How Vite learns `MAX_PLAINTEXT_BYTES` | Defined once in `.env`. Compose passes it to the backend as-is and to the frontend as `VITE_MAX_PLAINTEXT_BYTES` (dev: container env; prod: Docker build arg). Same mapping for `VITE_OIDC_ISSUER` and `VITE_OIDC_CLIENT_ID`. |
| G4 | Backend container → Keycloak reachability (base §25) | Local Keycloak publishes only `127.0.0.1:8080` with `KC_HOSTNAME=http://idp.localhost:8080`, so `host-gateway` cannot reach it. The backend joins the external Docker network `${IDP_DOCKER_NETWORK:-chismoso-idp_default}` and retrieves keys from `OIDC_JWKS_URL`. `OIDC_JWKS_URL` is **optional**: when unset it defaults to `${OIDC_ISSUER}/protocol/openid-connect/certs` (the production case, where Keycloak is reached by URL, not by Docker network). Dev `.env` sets `OIDC_JWKS_URL=http://keycloak:8080/realms/chismoso/protocol/openid-connect/certs`. JWT `iss` is always validated against `OIDC_ISSUER` (base §25 rule preserved). The external network exists only in the local compose files. |
| G5 | Organization username syntax (base §4) | After trim + lowercase: reject anything containing `@` (email form), then require `^[a-z0-9][a-z0-9._-]{0,63}$`. |
| G6 | Host port conflict | Host port 5432 is taken by another Postgres. Chismoso DB is published on `127.0.0.1:5433`. |
| G7 | Test credentials for browser e2e | Dev users' passwords are their lowercase first names (`aperez`/`alicia`, `bgonzalez`/`boberto`, `csaul`/`carlitos`, `dlopez`/`daniel`, `efuseneco`/`elena`, `flapinto`/`franco`). They live only in an e2e test fixture, never in application config or `.env`. |
| G8 | Reverse proxy choice | Caddy. |
| G9 | JWT library | PyJWT with a cached `PyJWKClient`. |

## 3. Repository layout and infrastructure

```
tp_final/
  chismoso_spec_v1_1_reconciled.md     # base spec (unchanged)
  README.md                            # exact commands, verified local flow, prod notes
  .env.example                         # every app-facing variable, dummy values
  .env                                 # gitignored
  compose.yaml                         # dev stack
  compose.prod.yaml                    # prod-like smoke stack
  infra/
    caddy/Caddyfile.dev
    caddy/Caddyfile.prod
    postgres/init/                     # creates chismoso and chismoso_test DBs
  backend/                             # uv project, Dockerfile
  frontend/                            # Vite project, Dockerfile (multi-stage)
  docs/                                # this design, plans, decisions
```

**Dev stack (`compose.yaml`)**: `db` (`postgres:18-alpine`, `127.0.0.1:5433:5432`), `backend` (uvicorn `--reload`, source bind-mounted, joins the external IdP network), `frontend` (Vite dev server listening on `0.0.0.0`, HMR client port 3000), `proxy` (Caddy, published on `127.0.0.1:3000` **and** `[::1]:3000` because `app.localhost` resolves to `::1` on the dev host).

**Prod-like stack (`compose.prod.yaml`)**: `db`, `backend` (no reload), and `web`, which is Caddy serving the built static bundle produced by the frontend Dockerfile's build stage. It uses the same `127.0.0.1:3000` / `[::1]:3000` publication because Keycloak only allows the `http://app.localhost:3000` origin. Dev and prod-like stacks therefore run **one at a time**.

**Caddy routing (both)**: plain `http://` site (no automatic HTTPS redirect locally), `/api/*` → backend **without stripping `/api`**, everything else → Vite (dev, incl. WebSocket upgrade) or static files with SPA fallback to `index.html` (prod). Request body size limit on `/api/*`. Security headers: prod uses base §27 exactly (CSP `connect-src` includes the Keycloak origin). Dev relaxes CSP only for Vite needs (inline React-refresh preamble, HMR WebSocket on the same origin), and never allows third-party script sources.

## 4. Backend architecture

FastAPI, Pydantic 2, SQLAlchemy 2 synchronous ORM, Psycopg 3, Alembic, uv, CPython 3.14 (non-free-threaded). Route handlers are plain `def` (threadpool). Modules under `backend/app/`:

| Module | Responsibility |
|---|---|
| `config.py` | pydantic-settings; all env variables from base §19 plus `OIDC_JWKS_URL` (optional) |
| `db.py` | engine/session factory |
| `models.py` | `Share`, `SharePayload`, `RecipientGrant` per base §5 (restrictive FKs, no status columns) |
| `migrations/` | Alembic; `0001` creates the three tables and indexes |
| `auth.py` | Bearer extraction; PyJWT verify signature via cached `PyJWKClient`, `iss`, `exp`/`nbf`, `chismoso-api` ∈ `aud`; `current_user` dependency (canonical `preferred_username`); `require_admin` dependency (`resource_access.<OIDC_ADMIN_CLIENT_ID>.roles` ∋ `OIDC_ADMIN_ROLE`) |
| `usernames.py` | canonicalization + validation (G5) |
| `encoding.py` | unpadded base64url encode/decode with pre-decode length checks |
| `errors.py` | uniform `{"error": {"code", "message"}}` envelope; handlers for app errors, `RequestValidationError` (→ 422 `invalid_request`, never echoing input), and unhandled (→ 500 `internal_error`) |
| `shares.py` | `POST /api/v1/shares`: validation, token generation, single transaction, commit before response |
| `consume.py` | `POST /api/v1/access/consume`, following base §12.1/§12.2 exactly |
| `admin.py` | `GET /api/v1/admin/shares` pagination |
| `logging_mw.py` | access logging: method, route template, status, latency only |
| `main.py` | app assembly, exception handlers, response security headers |

Implementation notes:

- **Expiry computation:** `expires_at = now() + interval`. SQLAlchemy's `func.make_interval` does **not** work with named arguments; call it positionally as `func.make_interval(0, 0, 0, 0, 0, minutes)` (years, months, weeks, days, hours, mins). Binding a Python `timedelta` is an acceptable equivalent.
- **Consume token handling:** the request body field is a string; invalid base64url / wrong decoded length produces the same 404 `share_not_found` as an unknown token. The hash is `SHA-256` of the **32 decoded token bytes**.
- **Logging:** uvicorn's built-in access log is disabled (it would log full paths, harmless here but not under our control). No request or response body logging anywhere.
- **Response headers on all API responses:** `Cache-Control: no-store`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

## 5. Frontend architecture

React + TypeScript + Vite, `react-router-dom`, `oidc-client-ts`, WebCrypto. Plain CSS in the first pass.

| Unit | Responsibility |
|---|---|
| `crypto/v1.ts` | pure functions: `encryptV1(plaintext) → {cek, nonce, ciphertext}` (base64url), `decryptV1(...)`. AAD `secret-handoff:v1`, 32-byte CEK, 12-byte nonce, 128-bit tag. |
| `crypto/base64url.ts` | unpadded base64url |
| `link.ts` | build `https://<origin>/s#v=1&t=<token>&k=<cek>`; parse the fragment with strict validation (version, 43-char token, CEK decoding to 32 bytes) |
| `auth/` | `UserManager` with `InMemoryWebStorage` for **both** `userStore` and `stateStore`, `popup_redirect_uri = <origin>/auth/callback`, scope `openid`, `automaticSilentRenew: false`, no `offline_access`; `AuthProvider` context exposing `user`, `login()` (popup), `logout()` |
| `api.ts` | `fetch` wrapper adding bearer, parsing the error envelope into typed errors |
| `i18n/` | Spanish UI strings and error-code → Spanish message map |
| `pages/CreatePage` (`/`) | plaintext textarea (byte-limit check vs `VITE_MAX_PLAINTEXT_BYTES`), recipients input (comma/space/newline separated, client-side email-form rejection), label, `shared_token` checkbox, expiry presets (10 min, 1 h, 1 día, 7 días, 15 días, 30 días, Personalizado) + custom minutes; encrypt locally → POST → list of `recipient → link` with copy buttons |
| `pages/OpenPage` (`/s`) | explicit state machine: `insecure_context` · `malformed_link` · `needs_login` · `ready` (one-time warning + button) · `consuming` · `revealed` (plaintext + copy) · `decrypt_failed` (explains grant **was consumed**) · `error` (mapped code) |
| `pages/AdminPage` (`/admin`) | paginated metadata table; 403 → Spanish no-access message |
| `pages/AuthCallback` (`/auth/callback`) | only calls `signinPopupCallback()`; never consumes |

Behavior rules:

- Secure context (`window.isSecureContext && crypto.subtle`) is checked at app start; failure shows a Spanish unsupported/insecure-context error.
- Memory-only auth means a page reload requires logging in again (a one-click popup thanks to the Keycloak SSO cookie). On API 401 the UI drops the user and asks to log in again; consume is **never** retried automatically.
- The URL fragment is not scrubbed (base §7).

**Deferred to the UI polish cycle:** shadcn/ui + Tailwind (or similar). Note for that cycle: Radix primitives set inline `style=` attributes, which the strict `style-src 'self'` CSP blocks. That needs evaluation then; it is not solved now.

## 6. Testing strategy

- **Backend (pytest)**: runs on the host via `uv` against `chismoso_test` on `127.0.0.1:5433` with migrations applied by a session fixture. JWT tests sign tokens with a test RSA key and a stubbed JWK client, so Keycloak is not needed. Coverage follows base §30: create validation and rollback, normalization, token modes, 404 vs 410 rules, TTL boundary using DB time, `revoked_at`/payload-deleted 410s (set directly in DB), JWT rejections, admin 403 and no admin bypass, no-store headers, version-agnostic `crypto_version`. **Concurrency:** threads with independent sessions: same-grant consume yields exactly one success; shared-token different grants both succeed; a simulated cleanup transaction (Share → Grant lock order) running concurrently with consumes produces no deadlocks. **Log redaction:** captured logs and exception output contain no raw token, CEK, plaintext, auth header, ciphertext body or full URL.
- **Cross-client crypto vectors:** `backend/scripts/gen_crypto_vectors.py` (using `cryptography`, a dev dependency) writes `frontend/src/crypto/__fixtures__/v1-vectors.json` with fixed CEK/nonce/plaintext cases (ASCII, multi-byte UTF-8, empty). A pytest re-verifies the file with Python; Vitest verifies the TS implementation against it.
- **Frontend (Vitest)**: crypto vectors + round trip; base64url; link build/parse (all malformed cases); error mapping; OpenPage logic with mocked API: malformed fragment never calls consume, callback never consumes, wrong CEK → `decrypt_failed` after exactly one consume call, no automatic retry.
- **Browser e2e (Playwright, Chromium)** against `http://app.localhost:3000` with real Keycloak popups (credentials from G7): aperez creates for bgonzalez+csaul (individual and shared modes), each consumes once, a second consume gets 410; wrong user gets 404; tampered CEK gets consumed and then a decrypt failure; flapinto sees admin metadata with no sensitive fields; a non-admin gets 403; the dev HMR WebSocket connects; plaintext byte limit enforced from the env value. A **prod-like smoke** spec runs a reduced create/consume flow against `compose.prod.yaml`.

## 7. Build order (implementation plan milestones)

1. **Scaffold + infra + DB:** repo layout, `.env.example`, compose dev stack, Caddy dev, Postgres init, backend skeleton + Alembic `0001`, frontend skeleton; verify proxy, HMR, JWKS reachability from the backend container.
2. **Backend, test-first:** usernames/encoding/errors/auth, then create, consume (with concurrency tests), admin, logging/headers.
3. **Frontend:** crypto + vectors, link, auth, api, pages (basic UI).
4. **Integration:** Playwright e2e, prod Caddyfile + `compose.prod.yaml` + smoke, README and docs.
5. **UI/UX polish:** a separate brainstorm → plan cycle **after** milestones 1–4 are green.

Execution: subagent-driven development, one task per subagent. Model choice by task: Sonnet for mechanical or well-specified tasks (scaffolding, config, simple endpoints, UI pages from clear specs), Opus for correctness-critical ones (consume transaction + concurrency tests, auth/JWT validation, crypto + vectors, compose/Keycloak networking, e2e popup flows). Work happens on branch `tp-final`.

## 8. Out of scope

Everything the base spec §2/§24 marks as post-MVP or excluded. Also: a redirect-based OIDC fallback, runtime config discovery, and UI polish (milestone 5).
