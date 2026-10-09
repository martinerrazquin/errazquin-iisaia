from dataclasses import dataclass
from typing import Annotated

from fastapi import APIRouter, Depends
from pydantic import BaseModel, StrictStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CurrentPrincipal
from app.deps import get_session
from app.encoding import encode_b64url
from app.errors import gone, share_not_found
from app.models import RecipientGrant, Share, SharePayload
from app.tokens import hash_access_token

router = APIRouter(prefix="/api/v1")


class ConsumeRequest(BaseModel):
    access_token: StrictStr


class ConsumeResponse(BaseModel):
    crypto_version: int
    ciphertext: str
    nonce: str


@dataclass(frozen=True)
class ConsumedPayload:
    crypto_version: int
    ciphertext: bytes
    nonce: bytes


def consume_grant(session: Session, token_hash: bytes, recipient_identity: str) -> ConsumedPayload:
    """Atomically claim one grant. Lock order is Share -> RecipientGrant (base spec §12)."""
    with session.begin():
        candidate = session.execute(
            select(RecipientGrant.id, RecipientGrant.share_id).where(
                RecipientGrant.access_token_hash == token_hash,
                RecipientGrant.recipient_identity == recipient_identity,
            )
        ).one_or_none()
        if candidate is None:
            raise share_not_found()

        share = session.execute(
            select(Share).where(Share.id == candidate.share_id).with_for_update()
        ).scalar_one()
        grant = session.execute(
            select(RecipientGrant).where(RecipientGrant.id == candidate.id).with_for_update()
        ).scalar_one()

        # Recheck under locks; also protects against future updates of these rows.
        if (
            grant.share_id != share.id
            or grant.access_token_hash != token_hash
            or grant.recipient_identity != recipient_identity
        ):
            raise share_not_found()

        # clock_timestamp(), not now(): judge expiry at actual claim time, after waiting for locks.
        db_now = session.scalar(select(func.clock_timestamp()))
        if grant.consumed_at is not None:
            raise gone("share_already_consumed")
        if share.expires_at <= db_now:
            raise gone("share_expired")
        if share.revoked_at is not None:
            raise gone("share_revoked")
        if share.payload_deleted_at is not None:
            raise gone("share_payload_deleted")

        payload = session.get(SharePayload, share.id)
        if payload is None:
            raise gone("share_payload_deleted")

        result = ConsumedPayload(
            crypto_version=payload.crypto_version, ciphertext=payload.ciphertext, nonce=payload.nonce
        )
        grant.consumed_at = db_now
    # Only reached after a successful commit.
    return result


@router.post("/access/consume", response_model=ConsumeResponse)
def post_consume(
    body: ConsumeRequest,
    principal: CurrentPrincipal,
    session: Annotated[Session, Depends(get_session)],
) -> ConsumeResponse:
    token_hash = hash_access_token(body.access_token)
    if token_hash is None:
        raise share_not_found()  # malformed tokens look exactly like unknown ones
    payload = consume_grant(session, token_hash, principal.username)
    return ConsumeResponse(
        crypto_version=payload.crypto_version,
        ciphertext=encode_b64url(payload.ciphertext),
        nonce=encode_b64url(payload.nonce),
    )
