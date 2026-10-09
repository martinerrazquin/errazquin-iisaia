import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    Text,
    UniqueConstraint,
    Uuid,
)
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class Share(Base):
    __tablename__ = "shares"

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    creator_identity: Mapped[str] = mapped_column(Text, nullable=False)
    # Non-secret metadata; length is enforced in business logic, not by the column type.
    label: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    payload_deleted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


Index("ix_shares_created_at_id", Share.created_at.desc(), Share.id.desc())


class SharePayload(Base):
    __tablename__ = "share_payloads"
    __table_args__ = (
        CheckConstraint("crypto_version > 0", name="ck_share_payloads_crypto_version_positive"),
    )

    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("shares.id", ondelete="RESTRICT"), primary_key=True
    )
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    nonce: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    # Opaque to the server: stored and returned, never interpreted.
    crypto_version: Mapped[int] = mapped_column(Integer, nullable=False)


class RecipientGrant(Base):
    __tablename__ = "recipient_grants"
    __table_args__ = (
        UniqueConstraint("share_id", "recipient_identity", name="uq_recipient_grants_share_recipient"),
        # Not unique: shared-token mode stores the same hash on several grants.
        Index("ix_recipient_grants_token_recipient", "access_token_hash", "recipient_identity"),
    )

    id: Mapped[uuid.UUID] = mapped_column(Uuid, primary_key=True, default=uuid.uuid4)
    share_id: Mapped[uuid.UUID] = mapped_column(
        Uuid, ForeignKey("shares.id", ondelete="RESTRICT"), nullable=False
    )
    recipient_identity: Mapped[str] = mapped_column(Text, nullable=False)
    access_token_hash: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    consumed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
