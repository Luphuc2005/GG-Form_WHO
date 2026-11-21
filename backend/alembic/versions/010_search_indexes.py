"""Indexed substring search without changing the existing search semantics."""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "010_search_indexes"
down_revision = "009_capacity_jobs"
branch_labels = None
depends_on = None

NAMES = ("uuid", "study", "so_hs", "ho_ten", "hospital_code", "encounter_code")


def upgrade():
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    # pg_trgm is a trusted PostgreSQL extension. The migration role needs CREATE
    # on this database (the Compose POSTGRES_USER owns its database).
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    table = sa.table("submissions", sa.column("submission_uuid", postgresql.UUID()),
                     sa.column("study_code", sa.String()), sa.column("answers", postgresql.JSONB()))
    expressions = [sa.cast(table.c.submission_uuid, sa.String), table.c.study_code]
    expressions.extend(table.c.answers["clinical_data"][key].as_string() for key in NAMES[2:])
    for name, expression in zip(NAMES, expressions):
        # Compile with the installed SQLAlchemy dialect so JSONB indexing syntax
        # matches the expressions used by the API's ILIKE predicates exactly.
        rendered = str(expression.compile(dialect=bind.dialect,
            compile_kwargs={"literal_binds": True, "include_table": False}))
        op.execute(sa.text(f"CREATE INDEX ix_submissions_search_{name} ON submissions USING gin (({rendered}) gin_trgm_ops)"))
    op.execute("ANALYZE submissions")


def downgrade():
    if op.get_bind().dialect.name == "postgresql":
        for name in NAMES:
            op.drop_index("ix_submissions_search_"+name, table_name="submissions")
