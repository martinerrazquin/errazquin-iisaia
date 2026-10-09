import pytest

from app.encoding import EncodingError, decode_b64url, encode_b64url


def test_round_trip_without_padding():
    data = bytes(range(32))
    encoded = encode_b64url(data)
    assert "=" not in encoded and len(encoded) == 43
    assert decode_b64url(encoded, max_bytes=32) == data


def test_uses_url_safe_alphabet():
    assert encode_b64url(b"\xfb\xff") == "-_8"


def test_empty_string_decodes_to_empty_bytes():
    assert decode_b64url("", max_bytes=10) == b""


@pytest.mark.parametrize(
    "value",
    [
        "AAAA=",       # padding
        "AA+A",        # standard alphabet
        "AA/A",
        "A",           # impossible length (len % 4 == 1)
        "AB",          # non-canonical: trailing bits set
        "AA AA",       # whitespace
        "AAAA\n",      # trailing newline
        "ÁAAA",        # non-ASCII
    ],
)
def test_rejects_invalid_encodings(value):
    with pytest.raises(EncodingError):
        decode_b64url(value, max_bytes=100)


def test_rejects_input_longer_than_max_bytes_allows():
    with pytest.raises(EncodingError):
        decode_b64url(encode_b64url(b"x" * 33), max_bytes=32)


def test_accepts_exactly_max_bytes():
    assert len(decode_b64url(encode_b64url(b"x" * 65552), max_bytes=65552)) == 65552
