import json

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.encoding import decode_b64url
from scripts.gen_crypto_vectors import AAD, OUTPUT, build_vectors


def load():
    return json.loads(OUTPUT.read_text(encoding="utf-8"))


def test_committed_vectors_match_generator():
    document = load()
    assert document["aad"] == "secret-handoff:v1"
    assert document["vectors"] == build_vectors()


def test_vectors_decrypt_with_independent_python_implementation():
    for vector in load()["vectors"]:
        cek = decode_b64url(vector["cek"], max_bytes=32)
        nonce = decode_b64url(vector["nonce"], max_bytes=12)
        ciphertext = decode_b64url(vector["ciphertext"], max_bytes=100_000)
        assert len(cek) == 32 and len(nonce) == 12
        assert len(ciphertext) == len(vector["plaintext"].encode("utf-8")) + 16
        assert AESGCM(cek).decrypt(nonce, ciphertext, AAD).decode("utf-8") == vector["plaintext"]
