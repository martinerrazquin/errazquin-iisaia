from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings read from environment variables (see .env.example)."""

    model_config = SettingsConfigDict(extra="ignore")

    database_url: str
    oidc_issuer: str
    oidc_expected_audience: str = "chismoso-api"
    oidc_admin_client_id: str = "chismoso"
    oidc_admin_role: str = "chismoso-admin"
    oidc_jwks_url: str | None = None

    min_expires_in_minutes: int = 10
    max_expires_in_minutes: int = 43200
    max_recipients_per_share: int = 100
    max_label_length: int = 256
    max_ciphertext_bytes: int = 65552
    max_nonce_bytes: int = 256
    max_admin_page_size: int = 100

    @property
    def jwks_url(self) -> str:
        """Key-retrieval URL; only the transport address may differ from the issuer."""
        if self.oidc_jwks_url:
            return self.oidc_jwks_url
        return f"{self.oidc_issuer.rstrip('/')}/protocol/openid-connect/certs"
