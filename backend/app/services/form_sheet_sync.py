"""Durable schema synchronization, independent of whether any records exist."""
from datetime import datetime, timezone, timedelta
from sqlalchemy import update
from app.models.form_management import FormSheetJob
from app.repositories.form_repo import FormRepository
from app.services.form_configuration import FORM_KEY, export_definitions
from app.services import google_sheets_svc as sheets


def ensure_schema(db):
    definitions, managed = export_definitions(db)
    if not managed:
        return
    current = FormRepository.get_published_by_key(db, FORM_KEY)
    headers, _, _ = sheets._read_sheet_data()
    expected = [d["label"] for d in definitions if d["export"]]
    if len(headers) == len(expected) and set(headers) == set(expected):
        return
    sheets._send_webhook({"action": "schema", "schema_version": current.version, "columns": definitions}, expected_status="schema_updated")
    actual, _, _ = sheets._read_sheet_data()
    if len(actual) != len(expected) or set(actual) != set(expected):
        raise RuntimeError("Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu.")


def process_schema_job(factory, settings):
    now = datetime.now(timezone.utc)
    with factory() as db:
        job = db.get(FormSheetJob, FORM_KEY)
        if not job or job.status == "synced":
            return False
        attempted = job.attempted_at
        if attempted and attempted.tzinfo is None:
            attempted = attempted.replace(tzinfo=timezone.utc)
        if job.status == "syncing" and attempted and attempted > now-timedelta(minutes=5):
            return False
        if job.status in ("failed", "not_configured") and (job.attempts >= 5 or attempted and attempted > now-timedelta(minutes=1)):
            return False
        version, attempts, status = job.target_version, job.attempts, job.status
        claimed = db.execute(update(FormSheetJob).where(FormSheetJob.form_key == FORM_KEY, FormSheetJob.target_version == version,
            FormSheetJob.attempts == attempts, FormSheetJob.status == status).values(status="syncing", attempts=attempts+1, attempted_at=now), execution_options={"synchronize_session": False}).rowcount
        db.commit()
        if claimed != 1:
            return False
        result = {"status": "synced", "error": None}
        if not settings.GOOGLE_SHEETS_WEBHOOK_URL or not settings.GOOGLE_SHEETS_SPREADSHEET_ID:
            result = {"status": "not_configured", "error": "Chưa cấu hình kết nối Google Sheets. Biểu mẫu và Excel vẫn dùng được."}
        else:
            try:
                with sheets._sync_lock:
                    ensure_schema(db)
            except Exception:
                result = {"status": "failed", "error": "Chưa cập nhật được cột Google Sheets. Kiểm tra kết nối và triển khai lại deploy/google_apps_script.js bản mới, rồi thử lại."}
        db.execute(update(FormSheetJob).where(FormSheetJob.form_key == FORM_KEY, FormSheetJob.target_version == version,
            FormSheetJob.status == "syncing", FormSheetJob.attempts == attempts+1).values(**result))
        db.commit()
        return True
