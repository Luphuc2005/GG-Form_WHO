"""Initial database migration for WHO Ovarian Tumor Pathology Survey

Revision ID: 001_initial_schema
Revises: 
Create Date: 2026-09-10 16:30:00.000000

"""
from typing import Sequence, Union
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision: str = "001_initial_schema"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. form_versions
    op.create_table(
        "form_versions",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("form_key", sa.String(length=64), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False, server_default="published"),
        sa.Column("schema_json", postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite"), nullable=False),
        sa.Column("schema_hash", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("published_at", sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("form_key", "version", name="uq_form_key_version"),
    )
    op.create_index("ix_form_versions_form_key", "form_versions", ["form_key"])
    op.create_index("ix_form_versions_status", "form_versions", ["status"])

    # 2. submissions
    op.create_table(
        "submissions",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("submission_uuid", sa.CHAR(36), nullable=False),
        sa.Column("form_version_id", sa.BigInteger(), nullable=False),
        sa.Column("payload_hash", sa.String(length=64), nullable=False),
        sa.Column("classification", sa.String(length=32), nullable=False),
        sa.Column("answers", postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), "sqlite"), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["form_version_id"], ["form_versions.id"], ondelete="RESTRICT"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("submission_uuid", name="uq_submissions_submission_uuid"),
    )
    op.create_index("ix_submissions_form_version_id", "submissions", ["form_version_id"])
    op.create_index("ix_submissions_created_at", "submissions", ["created_at"])
    op.create_index("ix_submissions_payload_hash", "submissions", ["payload_hash"])
    op.create_index("ix_submissions_classification", "submissions", ["classification"])

    # 3. admin_users
    op.create_table(
        "admin_users",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("username", sa.String(length=64), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("username", name="uq_admin_users_username"),
    )
    op.create_index("ix_admin_users_username", "admin_users", ["username"])


def downgrade() -> None:
    op.drop_table("admin_users")
    op.drop_table("submissions")
    op.drop_table("form_versions")
