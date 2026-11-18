"""Server-issued study codes; preserve the identity of all existing records."""
from alembic import op
import sqlalchemy as sa

revision = "004_study_identity"
down_revision = "003_public_entry"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("submissions", sa.Column("identity_version", sa.Integer(), nullable=False, server_default="1"))
    op.add_column("submissions", sa.Column("study_code", sa.String(16), nullable=True))
    op.add_column("submissions", sa.Column("study_number", sa.Integer(), nullable=True))
    op.create_index("uq_submissions_study_code", "submissions", ["study_code"], unique=True)
    op.create_table("study_sequences",
        sa.Column("hospital_code", sa.String(2), primary_key=True),
        sa.Column("phase", sa.String(1), primary_key=True),
        sa.Column("last_value", sa.Integer(), nullable=False))


def downgrade():
    op.drop_table("study_sequences")
    op.drop_index("uq_submissions_study_code", table_name="submissions")
    with op.batch_alter_table("submissions") as batch:
        batch.drop_column("study_number")
        batch.drop_column("study_code")
        batch.drop_column("identity_version")
