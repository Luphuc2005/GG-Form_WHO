"""Background exports and queue/list indexes for larger clinical datasets."""
from alembic import op
import sqlalchemy as sa

revision = "009_capacity_jobs"
down_revision = "008_sheet_cleanup"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table("export_jobs",
        sa.Column("id", sa.String(36), primary_key=True),
        sa.Column("requested_by", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("admin_users.id"), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("attempts", sa.Integer(), nullable=False),
        sa.Column("total_rows", sa.Integer(), nullable=False),
        sa.Column("row_count", sa.Integer(), nullable=False),
        sa.Column("storage_key", sa.String(100)),
        sa.Column("size_bytes", sa.Integer()),
        sa.Column("error", sa.String(500)),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("started_at", sa.DateTime(timezone=True)),
        sa.Column("finished_at", sa.DateTime(timezone=True)),
        sa.Column("expires_at", sa.DateTime(timezone=True)),
    )
    op.create_index("ix_export_jobs_requested_by", "export_jobs", ["requested_by"])
    op.create_index("ix_export_jobs_status_created", "export_jobs", ["status", "created_at"])
    op.create_index("ix_submissions_sync_queue", "submissions", ["sync_status", "sync_attempted_at"])
    op.create_index("ix_submissions_state_created", "submissions", ["workflow_status", "created_at", "id"])
    op.create_index("ix_submissions_owner_created", "submissions", ["owner_id", "created_at", "id"])


def downgrade():
    for name in ("ix_submissions_sync_queue", "ix_submissions_state_created", "ix_submissions_owner_created"):
        op.drop_index(name, table_name="submissions")
    op.drop_table("export_jobs")
