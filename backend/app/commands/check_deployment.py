"""Read-only preflight; never imports/publishes a form or contacts a Sheet."""
import argparse
import json
import sys
from urllib.parse import urlsplit
from sqlalchemy import inspect, text, select
from app.database import SessionLocal
from app.config import get_settings
from app.services.deployment_checks import database_revision, expected_revision, verify_current_schema


def check(db, settings, before_migration=False):
    current = database_revision(db)
    expected = expected_revision()
    tables = set(inspect(db.connection()).get_table_names())
    if tables and current is None:
        raise RuntimeError("Database có dữ liệu nhưng thiếu/không rõ phiên bản Alembic. Dừng cập nhật để kiểm tra; không stamp head lên database cũ.")
    if current:
        from alembic.config import Config
        from alembic.script import ScriptDirectory
        from pathlib import Path
        config = Config()
        config.set_main_option("script_location", str(Path(__file__).resolve().parents[2] / "alembic"))
        ScriptDirectory.from_config(config).get_revision(current)
    if db.bind.dialect.name == "postgresql" and current != expected:
        available = db.scalar(text("SELECT count(*) FROM pg_available_extensions WHERE name='pg_trgm'"))
        installed = db.scalar(text("SELECT count(*) FROM pg_extension WHERE extname='pg_trgm'"))
        can_create = db.scalar(text("SELECT has_database_privilege(current_user, current_database(), 'CREATE')"))
        if not available or not installed and not can_create:
            raise RuntimeError("Cần pg_trgm: nhờ quản trị database cài extension hoặc cấp CREATE cho tài khoản migration trước khi cập nhật.")
    if not before_migration:
        verify_current_schema(db)
    configured = [bool(str(getattr(settings, name) or "").strip()) for name in
                  ("GOOGLE_SHEETS_WEBHOOK_URL", "GOOGLE_SHEETS_SPREADSHEET_ID", "GOOGLE_SHEETS_WEBHOOK_TOKEN")]
    if any(configured) and not all(configured):
        raise RuntimeError("Kết nối Sheet cần đủ URL, Spreadsheet ID và token. Giữ nguyên bộ giá trị đang dùng hoặc để trống cả ba.")
    if all(configured):
        parsed = urlsplit(settings.GOOGLE_SHEETS_WEBHOOK_URL)
        if parsed.scheme != "https" or parsed.hostname != "script.google.com" or not parsed.path.endswith("/exec"):
            raise RuntimeError("Google Sheets cần URL Web App HTTPS của script.google.com kết thúc bằng /exec.")
    published = None
    if "form_versions" in tables:
        from app.models.form_version import FormVersion
        from app.schemas.form import FormSchemaDefinition
        form = db.scalar(select(FormVersion).where(FormVersion.form_key == "ovarian-pathology-who", FormVersion.status == "published").order_by(FormVersion.version.desc()).limit(1))
        if form:
            schema = FormSchemaDefinition.model_validate(form.schema_json)
            published = {"version": form.version, "managed": schema.clinical_fields is not None,
                         "clinical_fields": len(schema.clinical_fields or [])}
    return {"status": "ok", "database_revision": current, "target_revision": expected,
            "migration_needed": current != expected, "published_form": published,
            "sheets": "configured" if all(configured) else "disabled"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--before-migration", action="store_true")
    args = parser.parse_args()
    try:
        with SessionLocal() as db:
            print(json.dumps(check(db, get_settings(), args.before_migration), ensure_ascii=False))
    except RuntimeError as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(1)
    except Exception:
        print("Chưa kiểm tra được database/cấu hình triển khai. Kiểm tra kết nối và phiên bản trước khi dừng ứng dụng cũ.", file=sys.stderr)
        raise SystemExit(1)
