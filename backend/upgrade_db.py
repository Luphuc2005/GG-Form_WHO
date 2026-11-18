"""Upgrade local databases created before Alembic, preserving existing records."""
from pathlib import Path
from datetime import datetime
import sqlite3
from alembic import command
from alembic.config import Config
from alembic.migration import MigrationContext
from alembic.script import ScriptDirectory
from sqlalchemy import inspect
from app.database import engine
from app.models import Base


def upgrade_database():
    inspector = inspect(engine)
    tables = inspector.get_table_names()
    config = Config("alembic.ini")
    with engine.connect() as connection:
        current = MigrationContext.configure(connection).get_current_revision()
    if current == ScriptDirectory.from_config(config).get_current_head():
        return
    if not tables:
        Base.metadata.create_all(engine)
        command.stamp(Config("alembic.ini"), "head")
        return
    # SQLite's backup API produces a consistent snapshot even with WAL enabled.
    if engine.dialect.name == "sqlite" and engine.url.database not in (None, ":memory:"):
        source = Path(engine.url.database).resolve()
        target = source.parent / "backups" / f"{source.stem}-before-workflow-{datetime.now():%Y%m%d-%H%M%S-%f}.db"
        target.parent.mkdir(exist_ok=True)
        with sqlite3.connect(source) as src, sqlite3.connect(target) as dst:
            src.backup(dst)
        print(f"Đã tạo bản sao lưu SQLite: {target}")
    if "alembic_version" not in tables:
        # Old init_local_db.py created the baseline schema without a version table.
        if "workflow_status" in {c["name"] for c in inspector.get_columns("submissions")}:
            raise RuntimeError("Schema chưa có phiên bản nhưng đã có cột workflow; cần kiểm tra thủ công.")
        command.stamp(config, "001_initial_schema")
    command.upgrade(config, "head")


if __name__ == "__main__":
    upgrade_database()
