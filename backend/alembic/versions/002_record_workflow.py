"""Accounts, durable drafts, review history and synchronization state."""
from alembic import op
import sqlalchemy as sa

revision = "002_record_workflow"
down_revision = "001_initial_schema"
branch_labels = None
depends_on = None


def upgrade():
    if op.get_bind().dialect.name == "postgresql":
        from sqlalchemy.dialects.postgresql import UUID
        op.alter_column("submissions", "submission_uuid", type_=UUID(as_uuid=True), postgresql_using="submission_uuid::uuid")
    with op.batch_alter_table("admin_users") as batch:
        batch.add_column(sa.Column("role", sa.String(16), nullable=False, server_default="admin"))
    with op.batch_alter_table("submissions") as batch:
        batch.add_column(sa.Column("owner_id", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("reviewer_id", sa.BigInteger(), nullable=True))
        batch.add_column(sa.Column("workflow_status", sa.String(24), nullable=False, server_default="submitted"))
        batch.add_column(sa.Column("revision", sa.Integer(), nullable=False, server_default="1"))
        batch.add_column(sa.Column("encounter_key", sa.String(64), nullable=True))
        for name in ("updated_at", "submitted_at", "approved_at", "sync_attempted_at"):
            batch.add_column(sa.Column(name, sa.DateTime(timezone=True), nullable=True))
        batch.add_column(sa.Column("review_note", sa.String(2000), nullable=True))
        batch.add_column(sa.Column("sync_status", sa.String(24), nullable=False, server_default="not_requested"))
        batch.add_column(sa.Column("sync_error", sa.String(500), nullable=True))
        batch.add_column(sa.Column("sync_attempts", sa.Integer(), nullable=False, server_default="0"))
        batch.add_column(sa.Column("synced_revision", sa.Integer(), nullable=True))
        batch.create_foreign_key("fk_submission_owner", "admin_users", ["owner_id"], ["id"])
        batch.create_foreign_key("fk_submission_reviewer", "admin_users", ["reviewer_id"], ["id"])
        batch.create_unique_constraint("uq_submission_encounter", ["encounter_key"])
        batch.create_index("ix_submissions_owner_id", ["owner_id"])
        batch.create_index("ix_submissions_workflow_status", ["workflow_status"])
    op.create_table(
        "submission_events",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("submission_id", sa.BigInteger(), sa.ForeignKey("submissions.id"), nullable=False),
        sa.Column("actor_id", sa.BigInteger(), sa.ForeignKey("admin_users.id"), nullable=True),
        sa.Column("action", sa.String(32), nullable=False),
        sa.Column("revision", sa.Integer(), nullable=False),
        sa.Column("note", sa.String(2000), nullable=True),
        sa.Column("before_answers", sa.JSON(), nullable=True),
        sa.Column("after_answers", sa.JSON(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index("ix_submission_events_submission_id", "submission_events", ["submission_id"])


def downgrade():
    op.drop_table("submission_events")
    with op.batch_alter_table("submissions") as batch:
        batch.drop_constraint("fk_submission_owner", type_="foreignkey")
        batch.drop_constraint("fk_submission_reviewer", type_="foreignkey")
        batch.drop_constraint("uq_submission_encounter", type_="unique")
        batch.drop_index("ix_submissions_owner_id")
        batch.drop_index("ix_submissions_workflow_status")
        for name in ("owner_id", "reviewer_id", "workflow_status", "revision", "encounter_key", "updated_at", "submitted_at", "approved_at", "review_note", "sync_status", "sync_error", "sync_attempts", "synced_revision", "sync_attempted_at"):
            batch.drop_column(name)
    with op.batch_alter_table("admin_users") as batch:
        batch.drop_column("role")
