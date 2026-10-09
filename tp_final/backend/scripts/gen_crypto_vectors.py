"""Generate cross-client known-answer vectors for Chismoso crypto protocol v1.

Writes frontend/src/crypto/__fixtures__/v1-vectors.json. Run from backend/:
    uv run python -m scripts.gen_crypto_vectors
"""

import json
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app.encoding import encode_b64url

AAD = b"secret-handoff:v1"
OUTPUT = Path(__file__).resolve().parents[2] / "frontend" / "src" / "crypto" / "__fixtures__" / "v1-vectors.json"

CASES = [
    ("ascii", "correct horse battery staple", bytes(range(32)), bytes(range(100, 112))),
    ("utf8-multibyte", "contraseña: ñandú 🔐 — «secreto»", bytes([0xA5] * 32), bytes([0x5A] * 12)),
    ("multiline", "line one\nline two\r\n\ttabbed", bytes(range(255, 223, -1)), bytes(range(12))),
    ("empty", "", bytes([0x11] * 32), bytes(12)),
]


def build_vectors() -> list[dict[str, str]]:
    vectors = []
    for name, plaintext, cek, nonce in CASES:
        ciphertext = AESGCM(cek).encrypt(nonce, plaintext.encode("utf-8"), AAD)  # includes 16-byte tag
        vectors.append(
            {
                "name": name,
                "plaintext": plaintext,
                "cek": encode_b64url(cek),
                "nonce": encode_b64url(nonce),
                "ciphertext": encode_b64url(ciphertext),
            }
        )
    return vectors


def main() -> None:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    document = {"aad": AAD.decode("ascii"), "vectors": build_vectors()}
    OUTPUT.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
