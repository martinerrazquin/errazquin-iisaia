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
