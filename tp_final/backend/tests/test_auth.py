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
        "shared-secret-long-enough-for-hs256-keys",
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
