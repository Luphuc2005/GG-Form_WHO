"""Safe upgrade checks shared by deployment commands and readiness probes."""
from functools import lru_cache
from pathlib import Path
from alembic.config import Config
from alembic.script import ScriptDirectory
from sqlalchemy import inspect, select, text
from app.models import Base


@lru_cache
def expected_revision():
    config = Config()
    config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
    return ScriptDirectory.from_config(config).get_current_head()


def database_revision(db):
    inspector = inspect(db.connection())
    if not inspector.has_table("alembic_version"):
        return None
    revisions = list(db.scalars(text("SELECT version_num FROM alembic_version")))
    return revisions[0] if len(revisions) == 1 else None


def verify_current_schema(db):
    expected = expected_revision()
    if database_revision(db) != expected:
        raise RuntimeError("Database chưa chạy đủ migration. Chạy alembic upgrade head trước khi mở ứng dụng mới.")
    # SELECT 1 alone cannot detect a database stamped incorrectly or missing a
    # table/column needed by the new API and background worker.
    for table in Base.metadata.sorted_tables:
        db.execute(select(*table.c).limit(0))
    return expected
