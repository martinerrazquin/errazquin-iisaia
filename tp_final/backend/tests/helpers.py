import os
import time

import jwt

from app.encoding import encode_b64url

TEST_DATABASE_URL = os.environ.get(
    "TEST_DATABASE_URL", "postgresql+psycopg://chismoso:chismoso@127.0.0.1:5433/chismoso_test"
)

TEST_ISSUER = "http://idp.test/realms/chismoso"

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
