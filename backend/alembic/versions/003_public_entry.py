"""Allow direct form entry with a private per-draft capability."""
from alembic import op
import sqlalchemy as sa

revision = "003_public_entry"
down_revision = "002_record_workflow"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("submissions", sa.Column("public_access_hash", sa.String(64), nullable=True))


def downgrade():
    with op.batch_alter_table("submissions") as batch:
        batch.drop_column("public_access_hash")
