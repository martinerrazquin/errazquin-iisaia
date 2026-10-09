import uuid
from collections import defaultdict
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import AdminPrincipal
from app.config import Settings
from app.deps import get_session, get_settings
from app.errors import invalid_request
from app.models import RecipientGrant, Share
from app.timeutil import to_utc

MAX_PAGE = 1_000_000

router = APIRouter(prefix="/api/v1/admin")


class GrantMeta(BaseModel):
    recipient_identity: str
    consumed_at: datetime | None


class ShareMeta(BaseModel):
    id: uuid.UUID
    creator_identity: str
    label: str | None
    created_at: datetime
    expires_at: datetime
    revoked_at: datetime | None
    payload_deleted_at: datetime | None
    grants: list[GrantMeta]


class AdminSharesPage(BaseModel):
    items: list[ShareMeta]
    page: int
    page_size: int
    total: int


def _utc_or_none(value: datetime | None) -> datetime | None:
    return to_utc(value) if value is not None else None


@router.get("/shares", response_model=AdminSharesPage)
def list_shares(
    principal: AdminPrincipal,
    session: Annotated[Session, Depends(get_session)],
    settings: Annotated[Settings, Depends(get_settings)],
    page: Annotated[int, Query(ge=1, le=MAX_PAGE)] = 1,
    page_size: Annotated[int, Query(ge=1)] = 50,
) -> AdminSharesPage:
    if page_size > settings.max_admin_page_size:
        raise invalid_request("page_size is too large.")
    with session.begin():
        total = session.scalar(select(func.count()).select_from(Share))
        shares = session.scalars(
            select(Share)
            .order_by(Share.created_at.desc(), Share.id.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        ).all()
        grants_by_share: dict[uuid.UUID, list[GrantMeta]] = defaultdict(list)
        if shares:
            rows = session.execute(
                select(RecipientGrant.share_id, RecipientGrant.recipient_identity, RecipientGrant.consumed_at)
                .where(RecipientGrant.share_id.in_([s.id for s in shares]))
                .order_by(RecipientGrant.recipient_identity)
            ).all()
            for row in rows:
                grants_by_share[row.share_id].append(
                    GrantMeta(recipient_identity=row.recipient_identity, consumed_at=_utc_or_none(row.consumed_at))
                )
    items = [
        ShareMeta(
            id=s.id,
            creator_identity=s.creator_identity,
            label=s.label,
            created_at=to_utc(s.created_at),
            expires_at=to_utc(s.expires_at),
            revoked_at=_utc_or_none(s.revoked_at),
            payload_deleted_at=_utc_or_none(s.payload_deleted_at),
            grants=grants_by_share[s.id],
        )
        for s in shares
    ]
    return AdminSharesPage(items=items, page=page, page_size=page_size, total=total)
