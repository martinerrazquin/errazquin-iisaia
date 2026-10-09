import uuid
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Annotated

from fastapi import APIRouter, Depends, status
from pydantic import BaseModel, StrictBool, StrictInt, StrictStr
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import CurrentPrincipal
from app.config import Settings
from app.deps import get_session, get_settings
from app.encoding import EncodingError, decode_b64url
from app.errors import invalid_request
from app.models import RecipientGrant, Share, SharePayload
from app.timeutil import to_utc
from app.tokens import generate_access_token
from app.usernames import InvalidUsername, canonicalize_username

MAX_POSTGRES_INTEGER = 2_147_483_647

router = APIRouter(prefix="/api/v1")


class CreateShareRequest(BaseModel):
    ciphertext: StrictStr
    nonce: StrictStr
    crypto_version: StrictInt
    expires_in_minutes: StrictInt
    recipients: list[StrictStr]
    shared_token: StrictBool
    label: StrictStr | None = None


class GrantOut(BaseModel):
    recipient: str
    access_token: str


class CreateShareResponse(BaseModel):
    share_id: uuid.UUID
    crypto_version: int
    created_at: datetime
    expires_at: datetime
    grants: list[GrantOut]


@dataclass(frozen=True)
class ValidatedShare:
    ciphertext: bytes
    nonce: bytes
    crypto_version: int
    expires_in_minutes: int
    recipients: list[str]
    shared_token: bool
    label: str | None


@dataclass(frozen=True)
class CreatedShare:
    share_id: uuid.UUID
    created_at: datetime
    expires_at: datetime
    grants: list[tuple[str, str]]  # (recipient, raw access token)


def _is_utf8_encodable(text: str) -> bool:
    # JSON allows lone UTF-16 surrogates ("\ud800"), which PostgreSQL cannot store.
    try:
        text.encode("utf-8")
    except UnicodeEncodeError:
        return False
    return True


def validate_create_request(body: CreateShareRequest, settings: Settings) -> ValidatedShare:
    try:
        ciphertext = decode_b64url(body.ciphertext, max_bytes=settings.max_ciphertext_bytes)
        nonce = decode_b64url(body.nonce, max_bytes=settings.max_nonce_bytes)
    except EncodingError:
        raise invalid_request("ciphertext and nonce must be unpadded base64url within size limits.") from None
    if not ciphertext or not nonce:
        raise invalid_request("ciphertext and nonce must not be empty.")
    # Server stays version-agnostic: any positive integer that fits the column is accepted.
    if not 1 <= body.crypto_version <= MAX_POSTGRES_INTEGER:
        raise invalid_request("crypto_version must be a positive integer.")
    if not settings.min_expires_in_minutes <= body.expires_in_minutes <= settings.max_expires_in_minutes:
        raise invalid_request("expires_in_minutes is out of range.")
    if not body.recipients:
        raise invalid_request("At least one recipient is required.")
    if len(body.recipients) > settings.max_recipients_per_share:
        raise invalid_request("Too many recipients.")
    try:
        recipients = [canonicalize_username(raw) for raw in body.recipients]
    except InvalidUsername:
        raise invalid_request("Recipients must be valid usernames, not email addresses.") from None
    if len(set(recipients)) != len(recipients):
        raise invalid_request("Duplicate recipient usernames are not allowed.")
    label = (body.label or "").strip() or None
    if label is not None and len(label) > settings.max_label_length:
        raise invalid_request("label is too long.")
    if label is not None and ("\x00" in label or not _is_utf8_encodable(label)):
        raise invalid_request("label contains invalid characters.")
    return ValidatedShare(
        ciphertext=ciphertext,
        nonce=nonce,
        crypto_version=body.crypto_version,
        expires_in_minutes=body.expires_in_minutes,
        recipients=recipients,
        shared_token=body.shared_token,
        label=label,
    )


def create_share(session: Session, *, creator: str, data: ValidatedShare) -> CreatedShare:
    """Insert Share, SharePayload and one grant per recipient in one transaction."""
    grants: list[tuple[str, str]] = []
    with session.begin():
        db_now = session.scalar(select(func.now()))
        share = Share(
            creator_identity=creator,
            label=data.label,
            created_at=db_now,
            expires_at=db_now + timedelta(minutes=data.expires_in_minutes),
        )
        session.add(share)
        session.flush()
        session.add(
            SharePayload(
                share_id=share.id,
                ciphertext=data.ciphertext,
                nonce=data.nonce,
                crypto_version=data.crypto_version,
            )
        )
        shared = generate_access_token() if data.shared_token else None
        for recipient in data.recipients:
            token, token_hash = shared or generate_access_token()
            session.add(
                RecipientGrant(share_id=share.id, recipient_identity=recipient, access_token_hash=token_hash)
            )
            grants.append((recipient, token))
    # Committed: only now may raw tokens leave this function.
    return CreatedShare(share.id, share.created_at, share.expires_at, grants)


@router.post("/shares", status_code=status.HTTP_201_CREATED, response_model=CreateShareResponse)
def post_share(
    body: CreateShareRequest,
    principal: CurrentPrincipal,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> CreateShareResponse:
    data = validate_create_request(body, settings)
    created = create_share(session, creator=principal.username, data=data)
    return CreateShareResponse(
        share_id=created.share_id,
        crypto_version=data.crypto_version,
        created_at=to_utc(created.created_at),
        expires_at=to_utc(created.expires_at),
        grants=[GrantOut(recipient=r, access_token=t) for r, t in created.grants],
    )
