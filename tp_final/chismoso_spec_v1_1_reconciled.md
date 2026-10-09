# Chismoso — MVP Technical Specification (SPEC v1.1 — reconciled with v6)

**Status:** implementation handoff draft incorporating the decisions through 2026-10-08, reconciled against the supplied v6 baseline.  
**Audience:** implementation agents, reviewers, and the organization's operators.  
**Normative language:** **MUST**, **MUST NOT**, **SHOULD**, and **MAY** indicate requirement strength.

> **Document provenance:** This consolidated specification has been checked against the user-supplied 29-section `v6.md` baseline. The intentionally approved changes since v6 (fragment-only share tokens, consumption endpoint, crypto wire format, username-only inputs, transaction lock order, OIDC details, stack, limits, secure-context requirements, and dev reverse proxy) take precedence over superseded v6 wording.

## 1. Purpose and language

Chismoso is a self-hosted, internal, human-to-human, one-time secure secret handoff application. A sender selects explicitly named recipients; each authorized recipient can retrieve the encrypted payload only once. Chismoso is not a long-lived secrets manager, credential vault, rotation service, messenger, or file-transfer service.

Development documentation, code, API names, and implementation instructions **MUST** be in English. All human-facing frontend copy **MUST** be in Spanish. The source repository must contain frontend, backend, and database integration. The project is intended to be implemented with an AI coding agent and must favor direct, conventional implementations over architectural ceremony.

## 2. MVP capabilities and boundaries

MVP comprises: Keycloak-based human SSO; a sender screen to prepare and encrypt a text secret locally; one or more authorized recipients; individual or shared access-token generation; sender-side construction/copying of complete delivery URLs; a recipient page with explicit one-time consumption; and a metadata-only administrator backoffice with pagination.

There is **no anonymous sharing**. Both share creation and consumption require a valid authenticated user. There is no local user registration, local password, or local users table.

**Not MVP:** creator's ordinary-user share history, revocation actions, retention cleanup worker, administrative filtering, service-account authentication, idempotency keys, or distribution lists. See §24 for sequencing. Email delivery and notifications are **not** part of the Chismoso core or its planned delivery workflow; senders deliver links independently.

## 3. Security and trust model

The plaintext and Content-Encryption Key (CEK) **MUST** be generated/used in the sender's browser (or another trusted client) and **MUST NOT** be sent to the Chismoso backend. A fresh CEK is used for every Share. The backend persists encrypted payload and authorization metadata only. Recipients decrypt in their own client after authorized one-time retrieval.

Chismoso provides **encrypted payload confidentiality against passive application-server/DB data compromise**, not protection against actively malicious JavaScript supplied by the application's trusted origin. The application delivery infrastructure, Keycloak, and recipient endpoint are trusted within the stated model. Encryption does not replace recipient authentication/authorization. See §31 for accepted risks.

## 4. Identity, authentication, and authorization

- The corporate Keycloak realm is the identity authority. For MVP, human users authenticate through an OIDC **public** client using Authorization Code + PKCE S256.
- For sender/recipient identity, read the authenticated token's **`preferred_username`** claim. The application uses canonical usernames, not emails or UUID subjects, for business authorization and audit readability.
- Canonicalization: trim surrounding whitespace, lowercase consistently, then validate the username against the organization's accepted username syntax. **Input must be a username only. Reject any `@` / email-form recipient input; do not strip a domain.** Apply the same canonicalization to recipient requests and authenticated claim values.
- Recipients need not have previously used Chismoso; the creation API does not query Keycloak Admin API to resolve recipients.
- Usernames are organizationally immutable and never reused; this is an explicit deployment assumption. Do not add `creator_subject`, `consumer_subject`, or a local user directory.
- Only a Keycloak client role (`chismoso-admin`) authorizes admin-backoffice access. Admin status **does not** authorize consuming someone else's grant.
- Service-account/client-credentials authentication is a future extension of the **same API**, not a second API.

## 5. Database and metadata retention

Use PostgreSQL with three logical tables. IDs are internal UUIDs and are never retrieval capabilities.

### 5.1 `shares`

| Column | Type | Constraint / meaning |
|---|---|---|
| `id` | UUID | Primary key |
| `creator_identity` | TEXT | NOT NULL, canonical username |
| `label` | TEXT | NULL; non-secret, human-readable metadata |
| `created_at` | TIMESTAMPTZ | NOT NULL; DB time |
| `expires_at` | TIMESTAMPTZ | NOT NULL; DB time |
| `revoked_at` | TIMESTAMPTZ | NULL; included for post-MVP revocation |
| `payload_deleted_at` | TIMESTAMPTZ | NULL; included for post-MVP payload deletion |

Index: `(created_at DESC)`.

### 5.2 `share_payloads`

| Column | Type | Constraint / meaning |
|---|---|---|
| `share_id` | UUID | Primary and foreign key → `shares.id`; one payload per Share |
| `ciphertext` | BYTEA | NOT NULL; AEAD ciphertext including tag for protocol v1 |
| `nonce` | BYTEA | NOT NULL |
| `crypto_version` | INTEGER | NOT NULL; positive integer, opaque to backend |

### 5.3 `recipient_grants`

| Column | Type | Constraint / meaning |
|---|---|---|
| `id` | UUID | Primary key |
| `share_id` | UUID | Foreign key → `shares.id` |
| `recipient_identity` | TEXT | NOT NULL, canonical username |
| `access_token_hash` | BYTEA | NOT NULL, SHA-256 digest of raw access token |
| `consumed_at` | TIMESTAMPTZ | NULL; DB time |

Constraints/indexes: `UNIQUE (share_id, recipient_identity)` and nonunique index `(access_token_hash, recipient_identity)`. **Do not make `access_token_hash` unique:** shared-token mode intentionally duplicates it across recipients.

There are **no persisted status columns** on Shares or RecipientGrants and no persisted `shared_token` flag. Status is derived. Do not add `last_used_at`, a users table, or grant/Share lookup endpoints that expose secrets by UUID.

The label is plaintext audit/UX metadata **and MUST NOT contain any secret**. Enforce its configurable maximum length in business logic, **not** via a fixed database `VARCHAR(n)`/max-length constraint.

### 5.4 Retention

Shares and RecipientGrants (including labels and consumption metadata) remain **indefinitely by design**. Encrypted payload is separately physically deletable so future cleanup can remove content without destroying audit metadata. In MVP the cleanup worker is **not implemented**, but the schema includes `payload_deleted_at` now. Deleting Share rows is not part of routine cleanup; use restrictive foreign keys to avoid accidental cascading audit-history removal.

## 6. Client crypto protocol v1

For each Share, client performs all of the following **before** calling the create API:

1. Encode plaintext secret as UTF-8.
2. Generate a fresh uniformly random **32-byte (256-bit) CEK** with a cryptographically secure source.
3. Generate a fresh uniformly random **12-byte (96-bit) nonce**.
4. Encrypt via **AES-256-GCM**, with a **128-bit authentication tag**, using associated authenticated data (AAD) equal to UTF-8 bytes of exactly `secret-handoff:v1` (no newline or NUL).
5. Define `ciphertext` as the complete encryption result **including the appended 16-byte GCM tag**, as produced by browser WebCrypto AES-GCM.
6. Encode CEK, nonce, and ciphertext with **unpadded base64url** (RFC 4648 URL-safe alphabet `A–Z a–z 0–9 - _`, no `=`).
7. Set `crypto_version = 1` and final fragment version `v=1`.

The **client** validates version-specific details (32-byte CEK, 12-byte nonce, GCM tag, AAD and supported version). The **server does not interpret protocol versions**: it checks `crypto_version` is a positive integer, validates generic base64url/decoded sizes, stores it, and returns it unchanged. Server does not maintain a supported-crypto-version registry. API versioning (`/api/v1`) and crypto protocol versioning are independent.

No per-user encryption keys, server encryption keys, key escrow, CEK backup, or separate encryption microservice. A future SDK performs CEK generation → local encryption → API call → URL construction; it does not persist the CEK.

## 7. Access-token mechanism and final URL

Each token is generated server-side from **32 cryptographically random bytes**, then encoded as **43 unpadded base64url characters**. The raw token is returned in the create response only and **MUST NOT** be persisted. Persist only `SHA-256(raw token bytes)` as `access_token_hash`; a password KDF is unnecessary for 256-bit random credentials.

In **individual-token mode** the backend generates a distinct token for each RecipientGrant. In **shared-token mode** the backend generates one random token and stores its same hash on each recipient's independent grant. Mode is controlled solely by required creation input `shared_token: bool`; it is never stored.

The creator's client builds each complete URL **locally**:

```text
https://<handoff-host>/s#v=1&t=<43-character-access-token>&k=<base64url-32-byte-CEK>
```

For development the origin is `http://app.localhost:3000`. The backend **never constructs, receives, or logs the complete URL**, and never receives the CEK. Both token and CEK are located in the URL **fragment**, which is not transmitted with the HTTP navigation request. `GET /s` serves frontend only; the route contains no token.

The URL fragment is **not scrubbed in MVP**. Consider parsing it into memory followed by `history.replaceState()` as a post-v1 enhancement.

## 8. Public API contract overview

All authenticated APIs are served at the **same application origin** under `/api/v1`. MVP endpoints:

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/v1/shares` | Create encrypted Share and recipient grants |
| `POST` | `/api/v1/access/consume` | Atomically consume recipient grant and return encrypted payload |
| `GET` | `/api/v1/admin/shares?page=1&page_size=50` | Paginated metadata-only admin list |
| `GET` | `/s` | Frontend route; not an API; does **not** consume |

No `GET /api/v1/shares/{share_id}` or `GET /api/v1/grants/{grant_id}` to access secret content. No `GET` operation may consume a grant. Chismoso has no email-send endpoint.

API `Authorization: Bearer <OIDC access token>` is mandatory for the three API routes. Browser-issued access tokens are separate from the 43-character share access token.

## 9. Create Share: `POST /api/v1/shares`

Authenticated sender request:

```json
{
  "ciphertext": "<unpadded-base64url>",
  "nonce": "<unpadded-base64url>",
  "crypto_version": 1,
  "expires_in_minutes": 60,
  "recipients": ["bgonzalez", "csaul"],
  "shared_token": false,
  "label": "Staging database password"
}
```

Requirements:
- `ciphertext`, `nonce` must decode as valid unpadded base64url bytes and meet **generic** safe size limits; backend does not enforce protocol-v1 nonce length.
- `crypto_version`: positive integer; **do not** reject unknown positive versions merely because server cannot decrypt them.
- `expires_in_minutes`: integral range **10 through 43,200** by default (10 minutes through 30 days), configurable via environment.
- `recipients`: nonempty array of usernames; trim/lowercase/validate each; reject email-form inputs; enforce configured maximum recipients.
- Duplicate **normalized** recipient names cause **422**, rather than silent omission. Preserve caller order if convenient, but recipient ordering is **not** an API contract.
- `shared_token` is a **required boolean**, no default.
- `label` is optional and subject to configurable business-logic length maximum; plaintext non-secret metadata only.
- All DB writes are a **single transaction**: insert Share, one SharePayload, and one RecipientGrant per recipient. Compute `created_at` and `expires_at` with DB time. **Commit before returning** any raw tokens.
- Any failure aborts the entire create transaction; there is no partial creation.

Success response (`201 Created`, `Cache-Control: no-store` because the response contains raw share access tokens):

```json
{
  "share_id": "<UUID>",
  "crypto_version": 1,
  "created_at": "2026-10-08T20:00:00Z",
  "expires_at": "2026-10-08T21:00:00Z",
  "grants": [
    {"recipient": "bgonzalez", "access_token": "<raw-43-char-token>"},
    {"recipient": "csaul", "access_token": "<raw-43-char-token>"}
  ]
}
```

In shared-token mode both entries have the **same** raw token. Client combines each raw token with its local CEK to construct full URLs. No server-generated full URL field.

## 10. Recipient page and explicit one-time reveal

1. Opening `/s#v=1&t=...&k=...` loads the frontend only. HTTP navigation **MUST NOT** query grant existence or consume a grant.
2. Frontend parses fragment. Invalid/missing/unsupported version, token, or CEK yields a **Spanish** malformed/incomplete-link error **without** calling consume. For crypto v1, verify that decoded CEK is 32 bytes. A valid-looking but incorrect CEK cannot be recognized by the backend.
3. Recipient authenticates using the popup OIDC flow described in §18, without sending CEK or share token to Keycloak.
4. Authentication callback **MUST NOT** automatically call consume. The page requires a separate explicit user click. Display clear Spanish warning that the secret may be obtained only once.
5. Browser calls `POST /api/v1/access/consume` with the share access token in the JSON body, and the user's OIDC bearer token in `Authorization`.
6. On success, decrypt payload **locally** using CEK and protocol indicated by `crypto_version`; show plaintext and allow copying. Backend never learns whether decryption worked.
7. If AES-GCM authentication/decryption fails after an otherwise successful consume, explain in Spanish that the one-time grant **has been consumed**. **Never retry consume automatically**.

Every browser tab maintains its own CEK, URL fragment, and OIDC transaction state. Clients may not require device- or browser-persistent ownership.

## 11. Consume API: `POST /api/v1/access/consume`

Authenticated request:

```http
POST /api/v1/access/consume
Authorization: Bearer <OIDC-access-token>
Content-Type: application/json
Cache-Control: no-store
```

```json
{"access_token": "<43-character-share-access-token>"}
```

The endpoint uses POST because it permanently changes `consumed_at`. Using GET would invite accidental execution by prefetchers, browsers, and tooling. The token must **not** appear in the API path, query string, or access logs.

Success response (`200 OK`, no-store):

```json
{
  "crypto_version": 1,
  "ciphertext": "<unpadded-base64url>",
  "nonce": "<unpadded-base64url>"
}
```

The response includes no CEK, raw access token, recipient list, or metadata not required for local decryption.

Authorization and lifecycle checks occur **before** committing consumption. The backend authenticates OIDC, canonicalizes `preferred_username`, decodes/hashes the supplied share token, and finds a matching `(access_token_hash, recipient_identity)` grant. Unknown token and token for another recipient are both **404**. Only **after** finding an authorized matching grant may the backend distinguish consumed/expired/revoked/deleted as **410**.

## 12. Transactional correctness and lock ordering

**This section is a correctness requirement, not a suggested optimization.** Consumption, future cleanup, and future revocation **MUST acquire locks in the same order: `Share` → `RecipientGrant`**, where a recipient grant lock is applicable. Use PostgreSQL transactions with `READ COMMITTED`; do not introduce application-level locks or Redis.

### 12.1 Atomic consume sequence

1. Begin a DB transaction. Resolve candidate `(grant_id, share_id)` by `(SHA-256(raw access-token bytes), canonical authenticated username)` using a nonlocking indexed query. If absent, respond 404 without revealing grant state.
2. `SELECT shares ... WHERE id = :share_id FOR UPDATE` to lock the parent Share.
3. `SELECT recipient_grants ... WHERE id = :grant_id FOR UPDATE` to lock the particular grant. Recheck token hash, recipient identity and Share association under the lock.
4. Read **current DB time after locks have been acquired** for the lifecycle decision. Check `consumed_at`, `expires_at`, `revoked_at`, `payload_deleted_at`, and SharePayload existence. Return authorized `410` for any ineligible condition; **do not** change the grant.
5. Read the encrypted payload while holding the parent Share lock.
6. Set `RecipientGrant.consumed_at` to the DB timestamp acquired after locking; commit transaction.
7. Only after successful commit, return the already-read encrypted response. If commit fails, no success response is sent.

Two concurrent requests for **the same grant** serialize at its row lock: the first eligible request commits, and the second observes its `consumed_at` and receives 410. Two different recipients of a shared-token Share consume **independently**. Locking the parent Share may serialize those accesses but does not couple their grant states; this simpler locking choice is intentional for MVP.

### 12.2 Reference pseudocode (SQLAlchemy 2, synchronous)

The following is **illustrative transaction structure**, not directly copy-paste application code; authentication, Pydantic validation, exceptions and DTO mapping belong outside it.

```python
from sqlalchemy import select, func


def consume(session, token_hash: bytes, recipient_identity: str):
    result = None
    with session.begin():
        candidate = session.execute(
            select(RecipientGrant.id, RecipientGrant.share_id)
            .where(
                RecipientGrant.access_token_hash == token_hash,
                RecipientGrant.recipient_identity == recipient_identity,
            )
        ).one_or_none()
        if candidate is None:
            raise NotFound()  # no authorized match; transaction rolls back

        share = session.execute(
            select(Share)
            .where(Share.id == candidate.share_id)
            .with_for_update()
        ).scalar_one()

        grant = session.execute(
            select(RecipientGrant)
            .where(RecipientGrant.id == candidate.id)
            .with_for_update()
        ).scalar_one()

        # Recheck under locks. This is also protection against future updates.
        if (
            grant.share_id != share.id
            or grant.access_token_hash != token_hash
            or grant.recipient_identity != recipient_identity
        ):
            raise NotFound()

        db_now = session.scalar(select(func.clock_timestamp()))
        if grant.consumed_at is not None:
            raise Gone("share_already_consumed")
        if share.expires_at <= db_now:
            raise Gone("share_expired")
        if share.revoked_at is not None:
            raise Gone("share_revoked")
        if share.payload_deleted_at is not None:
            raise Gone("share_payload_deleted")

        payload = session.get(SharePayload, share.id)
        if payload is None:
            raise Gone("share_payload_deleted")

        result = {
            "crypto_version": payload.crypto_version,
            "ciphertext": encode_base64url(payload.ciphertext),
            "nonce": encode_base64url(payload.nonce),
        }
        grant.consumed_at = db_now
        # `with session.begin()` commits on normal exit; raises roll back.

    return result  # after successful commit
```

**Why `clock_timestamp()` here?** `CURRENT_TIMESTAMP`/`NOW()` in PostgreSQL refer to transaction start. A transaction can wait on the Share lock; a fresh post-lock DB timestamp ensures expiry is judged at actual grant-claim time. It also produces `consumed_at` consistently from DB time. This is a targeted precision improvement, not a new timing subsystem.

**Important:** Do not first lock RecipientGrant and then Share in any competing operation. Avoid a single ad hoc joined `FOR UPDATE` query unless lock order is proven equivalent. The table-level foreign keys do not replace these lifecycle locks.

### 12.3 Future cleanup coordination (not implemented in MVP)

A future worker, approximately hourly, will begin each deletion transaction by locking the Share row, then examine grants/payload under that lock, and physically delete the SharePayload while setting `payload_deleted_at` in the **same transaction**. Use configurable retention window `retention_window` with eligibility:

```text
payload_deleted_at IS NULL AND (
   expires_at + retention_window <= DB_NOW()
   OR (revoked_at IS NOT NULL AND revoked_at + retention_window <= DB_NOW())
   OR (all grants are consumed
       AND MAX(recipient_grants.consumed_at) + retention_window <= DB_NOW())
)
```

After locking, re-evaluate eligibility to avoid stale decisions. Metadata stays forever. Cleanup and consume cannot cross the Share lock while modifying payload/lifecycle. Future revocation must lock Share first as well.

## 13. Errors and status codes

All application errors use stable English codes independent of the localized UI:

```json
{
  "error": {
    "code": "share_already_consumed",
    "message": "This share has already been consumed."
  }
}
```

Frontend maps codes to Spanish text; it must not show raw backend implementation details. Require stable mapping:

| HTTP | Code / circumstance |
|---|---|
| `401` | `authentication_required` / `invalid_authentication` |
| `403` | `admin_access_required` (authenticated non-admin on admin route) |
| `404` | `share_not_found` (unknown token OR token not authorized for this username) |
| `410` | `share_already_consumed`, `share_expired`, `share_revoked`, `share_payload_deleted` (only after authorized grant match) |
| `422` | `invalid_request` for schema, fields, limits, duplicate normalized recipient usernames |
| `500` | `internal_error`, with no sensitive details |

For invalid share-token encoding/length on consume, return the same generic **404** as an unknown token. Do not distinguish invalid token syntax from a nonexistent token. Framework validation exceptions must be mapped to the uniform error envelope without leaking submitted secret values.

No idempotent retry recovery for successful consumption in MVP. If the backend commits and the network response is lost, the grant is still consumed.

## 14. Administrator backoffice

`GET /api/v1/admin/shares?page=1&page_size=50` is Keycloak-admin-role protected. Defaults: page 1; page size 50; configurable maximum 100. Paginate at the Share level in descending `(created_at, id)` order for stable results.

Response shape:

```json
{
  "items": [{
    "id": "<share-uuid>",
    "creator_identity": "aperez",
    "label": "Staging database password",
    "created_at": "2026-10-08T20:00:00Z",
    "expires_at": "2026-10-08T21:00:00Z",
    "revoked_at": null,
    "payload_deleted_at": null,
    "grants": [{"recipient_identity": "bgonzalez", "consumed_at": null}]
  }],
  "page": 1,
  "page_size": 50,
  "total": 1
}
```

Admin sees audit metadata only. **Never** expose ciphertext, nonce, access-token hash, raw access token, CEK, or plaintext through admin endpoints/UI. Admin authority never bypasses recipient authorization. Admin filters by creator, recipient, or date are post-MVP.

## 15. Derived Share and RecipientGrant lifecycle

- `RecipientGrant.consumed_at IS NULL` means unconsumed; non-NULL means consumed.
- Share is eligible to consume only if now is before `expires_at`, `revoked_at IS NULL`, `payload_deleted_at IS NULL`, and SharePayload exists, subject to that particular authorized grant being unconsumed.
- There are no `status` fields and no mutable counters of consumed grants.
- Shared-token mode does **not** imply shared-consumption state: two authorized users with the same token can each consume once.
- `revoked_at` is stored now for forward compatibility, but no creator revoke endpoint/UI is included in MVP.

## 16. Human and SDK client behavior

The human-oriented browser UI is one implementation of the API contract, not a privileged backend path. Future authenticated SDKs may create and consume Shares with the same API, performing their own crypto locally. SDKs must never submit the plaintext or CEK to the server.

Client-generated URLs are delivery artifacts, not server data. No built-in delivery by SMTP, messaging applications, notifications, or external hooks. Recipient authorizations are explicit usernames only; no groups or distribution-list expansion in MVP.

## 17. MVP frontend UX

Provide at least:
- **Create:** authenticated sender inputs plaintext, one or more usernames, `shared_token` mode, optional label, expiration preset or custom minutes; locally encrypts, submits ciphertext, and displays copyable full link(s).
- **Open/consume:** `/s` fragment parser, malformed/incomplete-link state, login action, explicit one-time consume button, result/error/reveal/copy state. A successfully retrieved plaintext may be copied or saved by the recipient; one-time access cannot control that.
- **Admin:** paginated metadata list available to users with `chismoso-admin` role, no payload access.

UI text must be Spanish. Suggested expiry presets: **10 minutos, 1 hora, 1 día, 7 días, 15 días, 30 días, Personalizado**. Custom input is integer minutes; backend is authoritative for limits. Do not introduce an editor, attachments, multiple views, or password protection.

Use React + TypeScript + Vite and conventional bundled UI components, including **shadcn/ui** if useful. shadcn source/npm dependencies bundled with the application are allowed. **No externally loaded runtime JavaScript, analytics, tag managers, session replay, or CDN-hosted scripts.**

## 18. OIDC browser mechanics

Use `oidc-client-ts` for the browser OIDC/OAuth mechanics; do not manually implement the Authorization Code exchange, PKCE verifier, state checks, or callback protocol.

**Primary MVP flow: popup.** A user click starts an OIDC popup using Authorization Code + PKCE S256 with a unique `state` per transaction. The callback must be securely correlated with the originating tab and expected origin. The originating tab retains the CEK and share token in memory; they must never be sent to Keycloak. Use a library configuration that keeps **access tokens and the OIDC user store memory-only**; do not use `localStorage`, refresh-token persistence, or `offline_access`. The popup authentication result must not itself trigger consumption.

OIDC auth may produce browser storage required by the library for temporary protocol state only where necessary; this must not contain CEK, plaintext, or raw share access token. Prefer memory-backed state where supported, and retain per-tab isolation. The frontend may reauthenticate when an access token expires. User explicitly clicks consume after auth.

**Approved contingency only if the popup is materially impractical:** perform a top-level redirect and temporarily put CEK and share token in per-tab `sessionStorage`, restore them after callback, and immediately delete those entries. This is **not a second implementation to build in MVP by default**. Never use `localStorage` for these values.

## 19. Configurable bounds and environment variables

Apply bounds in **backend business logic/Pydantic validation**; backend remains authoritative. Recommended defaults, configurable in `.env`:

```dotenv
MIN_EXPIRES_IN_MINUTES=10
MAX_EXPIRES_IN_MINUTES=43200
MAX_RECIPIENTS_PER_SHARE=100
MAX_LABEL_LENGTH=256
MAX_PLAINTEXT_BYTES=65536
MAX_CIPHERTEXT_BYTES=65552
MAX_NONCE_BYTES=256
MAX_ADMIN_PAGE_SIZE=100
```

Frontend v1 uses a **64 KiB UTF-8 plaintext limit by default**, configured by `MAX_PLAINTEXT_BYTES`, for its own v1 encryption. AES-GCM v1 adds a 16-byte tag; therefore the server's default generic ciphertext ceiling is 65,552 decoded bytes. **This ceiling is just a configurable transport limit, not server knowledge of `crypto_version`.** `MAX_NONCE_BYTES` is a generic cap, not v1 nonce validation. Body-size limits must also be applied at the proxy/application layer to prevent huge encoded requests.

The UI presets stay as listed even if operators change backend expiration limits; any mismatched selection is subject to normal backend validation. Operators should choose compatible bounds. Avoid building a runtime configuration discovery subsystem solely to synchronize presets in MVP.

For the web client, `MAX_PLAINTEXT_BYTES` is injected from the same environment configuration **at frontend build/start time**, not fetched from an API. Changing this value for a production static frontend requires rebuilding/redeploying that bundle; changing backend validation limits requires restarting/redeploying the backend as usual. Ensure `MAX_CIPHERTEXT_BYTES` accommodates the configured plaintext limit plus the 16-byte AES-GCM v1 tag; the backend still treats the ciphertext ceiling as a generic limit regardless of crypto version.

Other environment categories include:

```dotenv
DATABASE_URL=postgresql+psycopg://...
OIDC_ISSUER=http://idp.localhost:8080/realms/chismoso
OIDC_CLIENT_ID=chismoso
OIDC_EXPECTED_AUDIENCE=chismoso-api
OIDC_ADMIN_CLIENT_ID=chismoso
OIDC_ADMIN_ROLE=chismoso-admin
```

No `OIDC_CLIENT_SECRET`, no SMTP variables, and no server CEK/encryption key configuration for this protocol.

## 20. Technology and development conventions

**Backend:** normal (non-free-threaded) **CPython 3.14**, FastAPI, Pydantic 2, SQLAlchemy 2 synchronous ORM, Psycopg 3 synchronous driver, Alembic migrations, `uv` dependency management. Do not add async database infrastructure or extra service layers without demonstrated need. Use Pydantic models for API input/output.

**Frontend:** React, TypeScript, Vite, WebCrypto, `oidc-client-ts`, shadcn/ui (optional but allowed). Crypto code is part of the client bundle and should be well-tested independently.

**Infrastructure:** PostgreSQL and a reverse proxy in the Chismoso Compose setup, with the pre-existing Keycloak running separately. A simple monorepo structure is suitable: `backend/`, `frontend/`, `infra/`, `docs/`; exact internal Python modules and React component layout are agent choices.

Use parameterized SQL/ORM operations, migrations for schema, structured tests, and readable straightforward code. Do not invent service-account, email, cleanup, or other deferred endpoints.

## 21. Same-origin deployment and secure browser context

**Same origin is the contract** for the Chismoso frontend and its API:

```text
https://<app-host>/s
https://<app-host>/api/v1/...
```

Use a reverse proxy in **both development and production**. In development, the reverse proxy routes `/api/*` to FastAPI and all frontend routes to Vite (including WebSocket upgrade for hot reload). In production, the reverse proxy routes `/api/*` to FastAPI and serves the compiled frontend bundle (or proxies to a static-web container). **Preserve the `/api/v1` path** when forwarding to FastAPI. This avoids application CORS for frontend ↔ API, but Keycloak remains a separate origin and retains its own configured Web Origin restrictions.

Development browser origin: **`http://app.localhost:3000`**; existing Keycloak origin: **`http://idp.localhost:8080`**. Both work without a development CA. Browsers treat `.localhost` as a potentially trustworthy origin, so `crypto.subtle` is available in supported browsers; the app must feature-detect `window.isSecureContext` and `crypto.subtle` and show a Spanish unsupported/insecure-context error when unavailable.

Production browser origin **MUST** be a secure context, normally **HTTPS with a certificate trusted by clients**. TLS may terminate at a corporate gateway/proxy or at the application reverse proxy; **CA/certificate provisioning is an infrastructure decision**, not an in-app feature. Production IdP flows must use appropriately secured endpoints. Do not silently fall back to unsafe crypto, HTTP transport to end users, or a JavaScript AES implementation to bypass secure-context requirements.

The primary difference between environments is HTTP-on-localhost versus trusted HTTPS in production; a second deliberate difference is **Vite hot-reload server in development versus static built assets in production**. Backend routes and client behavior should otherwise match.

## 22. Security requirements and secrets handling

- Never log, trace, persist, or transmit CEKs or plaintext on the server. Never emit raw access tokens, authorization headers, full share URLs, or decrypted frontend values in logs, traces, analytics, error reports, or crash collection.
- Disable generic request/response-body logging for secret-related endpoints; never log create input ciphertext bodies or consume token bodies. Server can log safe method, route-template, status, latency and non-secret generated IDs.
- Never include share access tokens in server routes/query strings, log fields, exception messages, error responses, or redirect URLs.
- Enforce no-store where sensitive; maintain effective CSP/referrer controls (§27).
- Use only locally bundled first-party/installed code at runtime; avoid runtime third-party JavaScript.
- Protect OIDC identity and recipient grant with backend JWT checks on **every** API call, not only frontend route guards.
- API request size limits, client-side length checks, and secret-free error handling are required. Basic reverse-proxy abuse controls may be configured; sophisticated application rate limiting is not MVP.

## 23. No email or notification integration

The Chismoso backend has **no SMTP**, Mailpit, email templating, scheduled notifications, out-of-band delivery, or server URL assembler. Sender copies generated links and delivers them through an external communication channel of their choice. This is deliberate: the backend must never possess or reconstruct final CEK-bearing URLs. Any outside messaging workflow is a separate system, not part of the planned Chismoso app.

## 24. Post-MVP backlog and explicit exclusions

**Priority 1: encrypted-payload cleanup.** Use the retention conditions and DB-lock discipline in §12.3, with a configurable retention window and roughly hourly execution in a separate worker/container. Preserve Share and RecipientGrant audit metadata indefinitely.

**Priority 2: ordinary-user share listing.** Add `GET /api/v1/shares`, scoped to the authenticated creator, returning **metadata only** for shares they created. Do not return ciphertext, nonce, raw access tokens, access-token hashes, CEKs or plaintext. This is explicitly **post-MVP**, not a fourth authenticated MVP API endpoint.

**Priority 3: administrative share-history/audit UX.** Extend the metadata-only backoffice to make existing `created_at`, `expires_at`, `consumed_at`, `revoked_at` and `payload_deleted_at` data useful for historical review. No plaintext/ciphertext access.

**Priority 4: creator revocation.** `revoked_at` is already in the schema; the exact future endpoint is intentionally not frozen.

**Priority 5: service-account/OAuth client-credentials access** via the existing API, with separate suitable authorization decisions to be designed when needed.

**Lower-priority post-MVP:** admin filtering by creator, recipient, and date; rate limiting for creation/consumption/admin listing; low-priority idempotency keys; optional recipient groups/distribution lists only after considering accidental over-sharing; and URL fragment scrubbing after parsing. More specific 410 lifecycle reason codes are **already MVP** under §13 because that decision was approved after v6.

**Not planned without a new requirement:** email/notification delivery inside Chismoso, secret editing, multiple views, password-protected grants, attachment/file transfer, persistent per-user encryption keys/WebAuthn PRF, client-side key backup, secret rotation, or elaborate RBAC. Do not create stubs or schemas for these exclusions.

## 25. Development environment

There is **one application-facing environment-variable schema** across development and production. Production `.env` is gitignored. `.env.example` documents the same variable names with non-secret dummy values. The application should not contain environment-name branches for business behavior. Dev and production use the same reverse-proxy routing model (§21).

Local Compose includes at minimum: PostgreSQL, FastAPI backend, Vite frontend, and a reverse proxy; it **does not start Keycloak or Mailpit**. The Keycloak instance already exists in a separate repository/stack, with persistent PostgreSQL and the issuer described in §29.

The public dev URL **MUST** remain `http://app.localhost:3000`, with Caddy or equivalent accepting `http://` explicitly (do not inadvertently redirect local requests to an untrusted self-signed HTTPS origin). Proxy `/api/*` to the backend without stripping `/api`; proxy all other application routes and dev HMR WebSocket traffic to Vite. Vite must listen on an address reachable by the proxy container, with HMR client configuration compatible with port 3000.

The backend container must be able to fetch Keycloak OIDC discovery/JWKS from the **canonical issuer** `http://idp.localhost:8080/realms/chismoso`. Since `.localhost` resolves to loopback from the browser **and may resolve to the wrong loopback inside Docker**, the Compose/network wiring **MUST be explicitly tested**. Acceptable implementation choices include a shared Docker network/host alias or a reachable host-gateway mapping. **Never change the required JWT `iss` validation string** to an internal `keycloak:8080` alias. If a separate internal discovery/JWKS transport address is necessary, it may be configured only for key retrieval while preserving issuer verification against the canonical browser-visible issuer. Do not assume the user has to reinstall or reconfigure the already-working Keycloak realm.

No local CA is needed. Production CA/TLS integration remains an operator task. Test at least application UI load, OIDC popup/callback, JWT JWKS retrieval, WebCrypto secure-context availability, Vite HMR, and a real authorized encrypted consume through the proxy.

## 26. Nonnegotiable implementation invariants

1. Server **never** sees plaintext or CEK; clients are the only encryptors/decryptors.
2. Client generates a fresh CEK per Share; `crypto_version` is opaque server metadata.
3. Creator and consumer are always authenticated; backend authorization checks canonical Keycloak username for each grant.
4. Raw share access token is random 256 bits, returned on creation only, never persisted or logged; only SHA-256 digest is in DB.
5. A shared token identifies **different independent grants** for different authorized recipients.
6. No Share/Grant status columns, no local users table, no `shared_token` persistence.
7. Share/Grant UUIDs are identifiers, **not capabilities**.
8. Initial `GET /s` does not access or consume a grant; successful OIDC login does not auto-consume.
9. Missing/malformed CEK does not consume; a syntactically valid but incorrect CEK **does consume if authenticated/authorized**. Server cannot check decryption success.
10. One successful authorized POST can consume a grant exactly once; consumption and retrieval are one DB transaction with Share-before-Grant locking.
11. Unknown token/wrong recipient are indistinguishable 404s; authorized lifecycle failures are 410s.
12. Share creation is all-or-nothing; token response is sent only after commit.
13. The backend does not generate full links or conduct email/notification delivery.
14. Metadata is retained indefinitely; future payload removal leaves audit records.
15. Admins have metadata visibility only, never authorization to consume other users' grants.
16. All client-visible text is Spanish; code/docs/API and machine error codes are English.
17. Frontend/API are same-origin in dev and production; localhost HTTP is permitted, production requires secure browser context.
18. Do not implement post-MVP features implicitly; no auto-retry of consumed operations.

## 27. HTTP security headers and browser loading

Serve `/s`, the application shell, and relevant APIs with appropriate no-cache/no-referrer protections. Baseline production directives (compose as one valid CSP header):

```http
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self' <OIDC_ORIGIN>; img-src 'self' data:; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'
Referrer-Policy: no-referrer
X-Content-Type-Options: nosniff
Cache-Control: no-store
```

`frame-ancestors` is a **directive within the CSP header**, not a standalone HTTP header. Configure actual Keycloak origin in `connect-src`. Popup OIDC uses a top-level popup, not an iframe, so `frame-ancestors 'none'` does not prevent popup login. CSP may need **dev-only** adjustments for Vite HMR's local WebSocket/asset loading, never arbitrary third-party script exceptions. Avoid inline-script requirements; review exact bundled-library CSP needs during integration testing. Sensitive consume responses must have `Cache-Control: no-store`.

## 28. Proxy and observability

The URL token lives only in the fragment and the POST JSON body, so the proxy will not see it during initial `/s` navigation. Log **route templates**, methods, response statuses, timings, and operational diagnostics only; do not log complete sensitive request URLs/bodies or Authorization headers. Ensure backend, reverse proxy, exception middleware, error monitoring, and tracing all honor redaction. Do not add secret-content telemetry or external analytics.

Avoid HTTPS redirect at `http://app.localhost:3000` in local dev; production must terminate TLS at the selected corporate/application proxy. Trust forwarded headers only from configured reverse-proxy peers. Serve frontend and API through a single browser origin; there is no need for broad `Access-Control-Allow-Origin: *` on Chismoso endpoints.

## 29. Existing Keycloak / IdP integration

**The working local Keycloak installation is pre-existing and managed in a separate repo/stack.** Chismoso must integrate with it, not bootstrap another realm. Local Keycloak version **26.7.4** with persistent PostgreSQL, base URL `http://idp.localhost:8080`, realm `chismoso`, canonical issuer:

```text
http://idp.localhost:8080/realms/chismoso
```

Existing OIDC client:

| Setting | Value |
|---|---|
| Client ID | `chismoso` |
| Type | OIDC public client; client authentication OFF |
| Flow | Authorization Code/Standard Flow ON; PKCE S256 |
| Direct Access Grants | OFF |
| Redirect URI | `http://app.localhost:3000/*` |
| Web Origin | `http://app.localhost:3000` |

Keep these existing working local redirect and origin settings; tightening to an exact callback URI is optional and **not required** for MVP. Production Keycloak will require the matching production origin and callback configuration.

Development-only test usernames: `aperez`, `bgonzalez`, `csaul`, `dlopez`, `efuseneco`, `flapinto`. Development passwords must **not** be treated as production credentials or copied into application config. Only `flapinto` has the `chismoso-admin` client role. The authenticated token supplies `preferred_username`; the admin role is read at `resource_access.chismoso.roles`.

Issued access tokens include:

```json
"aud": ["chismoso-api", "account"]
```

Backend must validate Keycloak token **signature against JWKS**, **`iss`**, **`exp`** (and `nbf` if present), and **membership** of `chismoso-api` in `aud` rather than strict audience equality. Reject invalid tokens with 401. Admin role membership is checked server-side. No browser OIDC client secret is used; `OIDC_CLIENT_SECRET` is not part of MVP env config.

The `chismoso-api` audience mapper is configured on `chismoso` client's **dedicated client scope**, not as a separate realm client scope. Do **not** define a partial `clientScopes` array in realm JSON: it previously interfered with Keycloak's built-in `roles`, `profile`, and `email` scopes and broke Keycloak's account console (403). The existing account console and account-profile permissions are already verified functional. The bare authorization URL returning 400 without OIDC query parameters is expected; real authentication requests include state, redirect URI, client ID, and PKCE parameters.

## 30. Required tests and acceptance criteria

The implementation is not complete without executable tests covering:

- Crypto v1 cross-client known vectors; exact UTF-8, AAD, 32-byte CEK, 12-byte nonce, AES-GCM tag, unpadded base64url, and round-trip decryption.
- Server remains crypto-version agnostic: stores/returns unknown positive `crypto_version`; rejects nonpositive or invalid structural input without algorithm inspection.
- Creation transaction rollback on any failed grant insert; no returned tokens before commit.
- Username trim/lowercase normalization; rejection of email-style and duplicate normalized recipients; permission based on authenticated `preferred_username`.
- Individual mode generates different tokens, shared mode one token and distinct grants; concurrent consumption of different shared-token recipient grants both succeeds once.
- Same-grant concurrent consume: **exactly one** success, others 410; consumed timestamp written once. Test Share-before-Grant lock order and no deadlocks with simulated cleanup transaction.
- Wrong recipient and nonexistent token both 404; only an authorized grant can receive 410 lifecycle detail.
- Missing/malformed fragment never calls consume; valid-looking wrong CEK results in one consumption and client decryption failure; OIDC callback never automatically consumes.
- TTL expiry at boundary uses DB time; `revoked_at`, missing/deleted payload correctly return 410; no metadata deletion.
- JWT validation for valid signature/issuer/expiry/audience array; rejection of wrong `iss`, wrong `aud`, expiry, missing token; role-based 403 on admin route, no admin recipient bypass.
- No raw token, CEK, plaintext, auth header, ciphertext request body, or full URL in logs/exception messages; requests and responses marked no-store where required.
- Browser tests via **`http://app.localhost:3000` reverse proxy** with existing Keycloak: popup SSO, HMR (development), UI crypto secure context, send/create/copy link, recipient consume/decrypt; production-like proxy serving built static assets in a smoke test. Verify configured `MAX_PLAINTEXT_BYTES` is applied by the frontend and consistent with the configured generic ciphertext limit.
- Admin metadata pagination and no sensitive fields; Spanish UI labels/errors; no email workflow.

## 31. Explicitly accepted risks

1. **Trusted frontend bundle.** An actively compromised origin serving malicious JS can steal secret material; E2EE does not protect against that actor.
2. **Trusted Keycloak.** IdP compromise undermines recipient authentication and can expose authorization; outside Chismoso's threat model.
3. **Trusted recipient device.** Malware, browser extensions, screenshots, clipboard history, and voluntary copying are not prevented.
4. **One-time is one server retrieval.** It does not limit what a recipient does after receiving plaintext.
5. **Commit/network ambiguity.** Successful consume followed by lost HTTP response still irrevocably consumes the grant.
6. **Username policy is organizationally trusted.** Username change/reuse is excluded by company policy; no extra `sub` persistence or directory lookup is added.
7. **Link modification can cause denial of service.** A sender/relay can supply a valid-shaped but wrong CEK; the rightful recipient can consume once and fail decryption. No backend CEK validation or authenticated external delivery mechanism is planned.
8. **Metadata is plaintext.** Sender/recipient identities, labels, timestamps, and consumption audit data are visible to the service/DB; only payload content is client-encrypted.

## 32. Codex/ClaudeCode implementation guardrails

Implement MVP **only**. Do not reinterpret client-side encryption as server-side encryption, move the raw share token back into a URL path, add a local users table, add an authorization bypass for admins, or persist `shared_token` as a DB state. Never auto-consume from GET/popup callback. Never treat malformed CEK as valid for consumption. Do not add a server crypto algorithm registry. Keep the backend's version field opaque and database operations transactional as in §12.

Provide: migrations; `.env.example` with every application-facing env variable; Docker Compose development stack with reverse proxy; frontend and backend code; unit/integration/browser tests; README with exact commands and verified end-to-end local flow using the separately operated Keycloak instance. Prioritize simple maintainable code and clear behavior over framework abstractions. Keep operational handling of production certificates explicitly documented, but do not attempt to provision internal corporate PKI.
