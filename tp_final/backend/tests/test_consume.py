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
