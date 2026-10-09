import hashlib
import re

from app.encoding import decode_b64url
from app.tokens import generate_access_token, hash_access_token


def test_generated_token_shape_and_hash():
    token, token_hash = generate_access_token()
    assert re.fullmatch(r"[A-Za-z0-9_-]{43}", token)
    raw = decode_b64url(token, max_bytes=32)
    assert len(raw) == 32
    assert token_hash == hashlib.sha256(raw).digest()


def test_tokens_are_unique():
    assert len({generate_access_token()[0] for _ in range(100)}) == 100


def test_hash_access_token_matches_generation():
    token, token_hash = generate_access_token()
    assert hash_access_token(token) == token_hash


def test_hash_access_token_rejects_malformed():
    token, _ = generate_access_token()
    for bad in [token[:-1], token + "A", token[:-1] + "=", "+" + token[1:], "", "x" * 43 + "\n"]:
        assert hash_access_token(bad) is None
