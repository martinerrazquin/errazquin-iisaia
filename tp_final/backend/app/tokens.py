import hashlib
import secrets

from app.encoding import EncodingError, decode_b64url, encode_b64url

ACCESS_TOKEN_BYTES = 32
ACCESS_TOKEN_LENGTH = 43


def generate_access_token() -> tuple[str, bytes]:
    """Return (raw token for the creator, SHA-256 digest to persist). The raw token is never stored."""
    raw = secrets.token_bytes(ACCESS_TOKEN_BYTES)
    return encode_b64url(raw), hashlib.sha256(raw).digest()


def hash_access_token(token: str) -> bytes | None:
    """Digest of a presented token, or None if it is not a well-formed 43-char token."""
    if len(token) != ACCESS_TOKEN_LENGTH:
        return None
    try:
        raw = decode_b64url(token, max_bytes=ACCESS_TOKEN_BYTES)
    except EncodingError:
        return None
    if len(raw) != ACCESS_TOKEN_BYTES:
        return None
    return hashlib.sha256(raw).digest()
