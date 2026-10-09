import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import inspect
from sqlalchemy.exc import IntegrityError

from app.models import Share, SharePayload


def test_tables_exist(engine):
    assert {"shares", "share_payloads", "recipient_grants"} <= set(inspect(engine).get_table_names())


def test_no_status_columns(engine):
    insp = inspect(engine)
    assert {c["name"] for c in insp.get_columns("shares")} == {
        "id", "creator_identity", "label", "created_at", "expires_at", "revoked_at", "payload_deleted_at",
    }
    assert {c["name"] for c in insp.get_columns("recipient_grants")} == {
        "id", "share_id", "recipient_identity", "access_token_hash", "consumed_at",
    }
    assert {c["name"] for c in insp.get_columns("share_payloads")} == {
        "share_id", "ciphertext", "nonce", "crypto_version",
    }


def test_access_token_hash_is_not_unique(engine):
    insp = inspect(engine)
    uniques = [u["column_names"] for u in insp.get_unique_constraints("recipient_grants")]
    assert uniques == [["share_id", "recipient_identity"]]
    indexes = {i["name"]: i for i in insp.get_indexes("recipient_grants")}
    token_index = indexes["ix_recipient_grants_token_recipient"]
    assert token_index["column_names"] == ["access_token_hash", "recipient_identity"]
    assert not token_index["unique"]


def test_label_is_unbounded_text(engine):
    columns = {c["name"]: c for c in inspect(engine).get_columns("shares")}
    assert str(columns["label"]["type"]) == "TEXT"


@pytest.mark.parametrize("table", ["share_payloads", "recipient_grants"])
def test_foreign_keys_are_restrictive(engine, table):
    (fk,) = inspect(engine).get_foreign_keys(table)
    assert fk["referred_table"] == "shares"
    assert fk["options"].get("ondelete") == "RESTRICT"


def test_crypto_version_must_be_positive(session_factory):
    now = datetime.now(UTC)
    with session_factory() as session:
        share = Share(id=uuid.uuid4(), creator_identity="aperez", created_at=now, expires_at=now)
        session.add(share)
        session.flush()
        session.add(SharePayload(share_id=share.id, ciphertext=b"x", nonce=b"n", crypto_version=0))
        with pytest.raises(IntegrityError):
            session.flush()
        session.rollback()
