import logging
import urllib.request
import json
import threading
from sqlalchemy import select
from app.config import get_settings
from app.database import SessionLocal
from app.models.submission import Submission
from app.schemas.form import FormSchemaDefinition
from app.services.export_svc import ExportService

settings = get_settings()
logger = logging.getLogger("google_sheets")


def _sync_worker(submission_id: int) -> None:
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return

    db = SessionLocal()
    try:
        stmt = select(Submission).where(Submission.id == submission_id)
        sub = db.scalars(stmt).first()
        if not sub or not sub.form_version:
            return

        schema_def = FormSchemaDefinition.model_validate(sub.form_version.schema_json)
        columns = ExportService.get_columns_from_schema(schema_def)
        row_data = ExportService._flatten_submission_to_row(sub, columns)

        # Convert created_at in row_data to Vietnam time (GMT+7) for easy reading in Google Sheets
        from datetime import timedelta
        if sub.created_at and len(row_data) > 1:
            vn_time = (sub.created_at + timedelta(hours=7)).strftime("%H:%M:%S %d/%m/%Y")
            row_data[1] = vn_time

        # Build payload for Google Apps Script Webhook
        payload = {
            "headers": [col[2] for col in columns],      # Tiêu đề hiển thị (Nhãn + Mã biến)
            "keys": [col[0] for col in columns],         # Khóa nội bộ
            "row": row_data,
            "submission_uuid": str(sub.submission_uuid),
        }

        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=10) as response:
            logger.info(f"Đã đồng bộ phiếu {sub.submission_uuid} lên Google Sheets thành công (HTTP {response.status})")

    except Exception as e:
        logger.warning(f"Lưu ý: Không thể đồng bộ phiếu lên Google Sheets (DB vẫn an toàn): {e}")
    finally:
        db.close()


def trigger_google_sheets_sync(submission_id: int) -> None:
    """Trigger background sync to Google Sheets without blocking user request."""
    if settings.GOOGLE_SHEETS_WEBHOOK_URL and settings.GOOGLE_SHEETS_WEBHOOK_URL.strip():
        thread = threading.Thread(target=_sync_worker, args=(submission_id,), daemon=True)
        thread.start()


def _delete_worker(submission_uuid: str) -> None:
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return

    try:
        payload = {
            "action": "delete",
            "submission_uuid": submission_uuid,
        }
        req = urllib.request.Request(
            webhook_url,
            data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST"
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            logger.info(f"Đã gửi yêu cầu xóa phiếu {submission_uuid} trên Google Sheets (HTTP {response.status})")
    except Exception as e:
        logger.warning(f"Lưu ý: Không thể xóa dòng tương ứng trên Google Sheets: {e}")


def trigger_google_sheets_delete(submission_uuid: str) -> None:
    """Trigger background delete from Google Sheets without blocking."""
    if settings.GOOGLE_SHEETS_WEBHOOK_URL and settings.GOOGLE_SHEETS_WEBHOOK_URL.strip():
        thread = threading.Thread(target=_delete_worker, args=(submission_uuid,), daemon=True)
        thread.start()


def resync_all_to_google_sheets(db) -> dict:
    """Wipe and re-synchronize all current database submissions to Google Sheets."""
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return {"status": "error", "message": "Chưa cấu hình GOOGLE_SHEETS_WEBHOOK_URL"}

    from app.repositories.form_repo import FormRepository
    from datetime import timedelta

    form_ver = FormRepository.get_published_by_key(db, "ovarian-pathology-who")
    if not form_ver:
        return {"status": "error", "message": "Chưa có biểu mẫu"}

    schema_def = FormSchemaDefinition.model_validate(form_ver.schema_json)
    columns = ExportService.get_columns_from_schema(schema_def)
    headers = [col[2] for col in columns]

    stmt = (
        select(Submission)
        .where(Submission.form_version_id == form_ver.id)
        .order_by(Submission.created_at.asc())
    )
    all_subs = db.scalars(stmt).all()

    all_rows = []
    for sub in all_subs:
        row = ExportService._flatten_submission_to_row(sub, columns)
        if sub.created_at and len(row) > 1:
            vn_time = (sub.created_at + timedelta(hours=7)).strftime("%H:%M:%S %d/%m/%Y")
            row[1] = vn_time
        all_rows.append(row)

    payload = {
        "action": "resync_all",
        "headers": headers,
        "rows": all_rows,
    }

    req = urllib.request.Request(
        webhook_url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=15) as response:
        logger.info(f"Đã đồng bộ lại toàn bộ {len(all_rows)} phiếu lên Google Sheets (HTTP {response.status})")
        return {"status": "success", "count": len(all_rows)}

