import base64
import binascii
import re

_B64URL_ALPHABET = re.compile(r"[A-Za-z0-9_-]*")


class EncodingError(ValueError):
    """Input is not canonical unpadded base64url within the allowed size."""


def encode_b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _max_encoded_length(max_bytes: int) -> int:
    return (max_bytes * 4 + 2) // 3


def decode_b64url(value: str, *, max_bytes: int) -> bytes:
    # Length check first so oversized input is rejected before any decoding work.
    if len(value) > _max_encoded_length(max_bytes):
        raise EncodingError("value too long")
    if not _B64URL_ALPHABET.fullmatch(value) or len(value) % 4 == 1:
        raise EncodingError("not unpadded base64url")
    try:
        data = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
    except (binascii.Error, ValueError) as exc:
        raise EncodingError("not unpadded base64url") from exc
    if encode_b64url(data) != value:
        raise EncodingError("non-canonical base64url")
    return data
