from collections.abc import Callable
from dataclasses import dataclass
from typing import Annotated, Any

import jwt
from fastapi import Depends, Request

from app.config import Settings
from app.deps import get_settings
from app.errors import admin_access_required, authentication_required, invalid_authentication
from app.usernames import InvalidUsername, canonicalize_username

ALLOWED_ALGORITHMS = ["RS256"]

SigningKeyResolver = Callable[[str], Any]


@dataclass(frozen=True)
class Principal:
    username: str
    roles: frozenset[str]


class TokenVerifier:
    """Validates Keycloak access tokens: JWKS signature, iss, exp/nbf and audience membership."""

    def __init__(self, settings: Settings, signing_key_resolver: SigningKeyResolver | None = None) -> None:
        self._settings = settings
        if signing_key_resolver is None:
            jwk_client = jwt.PyJWKClient(settings.jwks_url, cache_keys=True, lifespan=300, timeout=5)

            def signing_key_resolver(token: str) -> Any:
                return jwk_client.get_signing_key_from_jwt(token).key

        self._resolve_key = signing_key_resolver

    def verify(self, token: str) -> Principal:
        try:
            key = self._resolve_key(token)
        except jwt.PyJWKClientConnectionError:
            raise  # IdP unreachable is a server-side failure (500), not a bad credential.
        except (jwt.PyJWKClientError, jwt.PyJWTError):
            raise invalid_authentication() from None
        try:
            claims = jwt.decode(
                token,
                key,
                algorithms=ALLOWED_ALGORITHMS,
                issuer=self._settings.oidc_issuer,
                # PyJWT accepts the token when this value is a member of a list `aud`.
                audience=self._settings.oidc_expected_audience,
                options={"require": ["exp", "iss", "aud"]},
            )
        except jwt.PyJWTError:
            raise invalid_authentication() from None
        username = claims.get("preferred_username")
        if not isinstance(username, str):
            raise invalid_authentication()
        try:
            canonical = canonicalize_username(username)
        except InvalidUsername:
            raise invalid_authentication() from None
        return Principal(username=canonical, roles=frozenset(_client_roles(claims, self._settings.oidc_admin_client_id)))


def _client_roles(claims: dict[str, Any], client_id: str) -> list[str]:
    resource_access = claims.get("resource_access")
    client = resource_access.get(client_id) if isinstance(resource_access, dict) else None
    roles = client.get("roles") if isinstance(client, dict) else None
    if not isinstance(roles, list):
        return []
    return [role for role in roles if isinstance(role, str)]


def get_verifier(request: Request) -> TokenVerifier:
    return request.app.state.verifier


def current_principal(
    request: Request, verifier: Annotated[TokenVerifier, Depends(get_verifier)]
) -> Principal:
    header = request.headers.get("authorization")
    if header is None:
        raise authentication_required()
    scheme, _, token = header.partition(" ")
    token = token.strip()
    if scheme.lower() != "bearer" or not token:
        raise invalid_authentication()
    return verifier.verify(token)


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]


def require_admin(principal: CurrentPrincipal, settings: Annotated[Settings, Depends(get_settings)]) -> Principal:
    if settings.oidc_admin_role not in principal.roles:
        raise admin_access_required()
    return principal


AdminPrincipal = Annotated[Principal, Depends(require_admin)]
