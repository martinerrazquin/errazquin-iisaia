"""Initial schema: shares, share_payloads, recipient_grants.

Revision ID: 0001
Revises:
Create Date: 2026-10-08
"""
import sqlalchemy as sa
from alembic import op

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "shares",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("creator_identity", sa.Text(), nullable=False),
        sa.Column("label", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("payload_deleted_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index(
        "ix_shares_created_at_id", "shares", [sa.text("created_at DESC"), sa.text("id DESC")]
    )
    op.create_table(
        "share_payloads",
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="RESTRICT", name="fk_share_payloads_share_id"),
            primary_key=True,
        ),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("crypto_version", sa.Integer(), nullable=False),
        sa.CheckConstraint("crypto_version > 0", name="ck_share_payloads_crypto_version_positive"),
    )
    op.create_table(
        "recipient_grants",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column(
            "share_id",
            sa.Uuid(),
            sa.ForeignKey("shares.id", ondelete="RESTRICT", name="fk_recipient_grants_share_id"),
            nullable=False,
        ),
        sa.Column("recipient_identity", sa.Text(), nullable=False),
        sa.Column("access_token_hash", sa.LargeBinary(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(timezone=True), nullable=True),
        sa.UniqueConstraint(
            "share_id", "recipient_identity", name="uq_recipient_grants_share_recipient"
        ),
    )
    op.create_index(
        "ix_recipient_grants_token_recipient",
        "recipient_grants",
        ["access_token_hash", "recipient_identity"],
    )


def downgrade() -> None:
    op.drop_table("recipient_grants")
    op.drop_table("share_payloads")
    op.drop_index("ix_shares_created_at_id", table_name="shares")
    op.drop_table("shares")
