"""Versioned form authoring drafts and spreadsheet schema queue."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "005_form_management"
down_revision = "004_study_identity"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("form_drafts",
        sa.Column("form_key", sa.String(64), primary_key=True),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("base_version", sa.Integer(), nullable=False),
        sa.Column("schema_json", sa.JSON().with_variant(postgresql.JSONB(), "postgresql"), nullable=False),
        sa.Column("updated_by", sa.String(64), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False))
    op.create_table("form_sheet_jobs",
        sa.Column("form_key", sa.String(64), primary_key=True),
        sa.Column("target_version", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("error", sa.String(500)),
        sa.Column("attempted_at", sa.DateTime(timezone=True)))


def downgrade():
    op.drop_table("form_sheet_jobs")
    op.drop_table("form_drafts")
