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
