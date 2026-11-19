"""Recoverable trash for clinical records."""
from alembic import op
import sqlalchemy as sa

revision = "006_submission_trash"
down_revision = "005_form_management"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("submissions", sa.Column("trashed_from_state", sa.String(24), nullable=True))
    op.add_column("submissions", sa.Column("trashed_at", sa.DateTime(timezone=True), nullable=True))


def downgrade():
    # Restore the original workflow state before removing trash metadata.
    op.execute(sa.text(
        "UPDATE submissions SET workflow_status = COALESCE(trashed_from_state, 'draft'), "
        "sync_status = 'pending', sync_attempts = 0, sync_error = NULL, revision = revision + 1 "
        "WHERE workflow_status = 'trashed'"
    ))
    with op.batch_alter_table("submissions") as batch:
        batch.drop_column("trashed_at")
        batch.drop_column("trashed_from_state")
