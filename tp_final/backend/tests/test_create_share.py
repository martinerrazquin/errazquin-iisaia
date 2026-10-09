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
