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
