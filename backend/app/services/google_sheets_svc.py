import logging
import urllib.request
import urllib.parse
import csv
import io
import json
import threading
import time
import uuid
from collections import Counter
from sqlalchemy import select
from app.config import get_settings
from app.database import SessionLocal
from app.models.submission import Submission
from app.schemas.form import FormSchemaDefinition
from app.services.export_svc import ExportService

settings = get_settings()
logger = logging.getLogger("google_sheets")
_sync_lock = threading.Lock()


def _send_webhook(payload: dict, expected_status: str = "success") -> None:
    """Apps Script can return HTTP 200 with an application-level error."""
    req = urllib.request.Request(
        settings.GOOGLE_SHEETS_WEBHOOK_URL,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=20) as response:
        try:
            result = json.loads(response.read().decode("utf-8-sig"))
        except (ValueError, UnicodeError) as exc:
            raise RuntimeError("Google Sheets không trả về xác nhận JSON hợp lệ.") from exc
    if not isinstance(result, dict) or result.get("status") != expected_status:
        raise RuntimeError("Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.")


def _read_sheet_snapshot() -> tuple[list[str], Counter]:
    """Read the configured sheet to verify UUIDs instead of trusting a sent count."""
    spreadsheet_id = settings.GOOGLE_SHEETS_SPREADSHEET_ID
    if not spreadsheet_id:
        raise RuntimeError("Chưa cấu hình GOOGLE_SHEETS_SPREADSHEET_ID để đối chiếu phiếu trên Sheet.")
    url = (
        "https://docs.google.com/spreadsheets/d/"
        f"{urllib.parse.quote(spreadsheet_id.strip(), safe='')}/export"
        f"?format=csv&gid=0&_sync={time.time_ns()}"
    )
    req = urllib.request.Request(url, headers={"Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=20) as response:
        if "text/csv" not in response.headers.get("Content-Type", "").lower():
            raise RuntimeError("Không đọc được Sheet đích để xác minh dữ liệu; kiểm tra quyền truy cập.")
        rows = list(csv.reader(io.StringIO(response.read().decode("utf-8-sig"))))
    if not rows:
        return [], Counter()
    counts: Counter = Counter()
    for row in rows[1:]:
        if not row or not any(cell.strip() for cell in row):
            continue
        try:
            key = str(uuid.UUID(row[0].strip()))
        except ValueError as exc:
            raise RuntimeError("Sheet có dòng không chứa mã phiếu UUID hợp lệ; chưa thể đối chiếu.") from exc
        counts[key] += 1
    return rows[0], counts


def _submission_row(sub: Submission) -> tuple[list[str], list]:
    schema_def = FormSchemaDefinition.model_validate(sub.form_version.schema_json)
    columns = ExportService.get_columns_from_schema(schema_def)
    label_map, code_map = ExportService._build_maps(schema_def)
    return (
        [str(col[2]) for col in columns],
        ExportService._flatten_submission_to_row(sub, columns, label_map, code_map),
    )


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
        label_map, code_map = ExportService._build_maps(schema_def)
        row_data = ExportService._flatten_submission_to_row(sub, columns, label_map, code_map)

        # Convert created_at in row_data to Vietnam time (GMT+7)
        from datetime import timedelta
        if sub.created_at and len(row_data) > 1:
            vn_time = (sub.created_at + timedelta(hours=7)).strftime("%H:%M:%S %d/%m/%Y")
            row_data[1] = vn_time

        # Build payload for Google Apps Script Webhook
        payload = {
            "headers": [str(col[2]) for col in columns],
            "keys": [str(col[0]) for col in columns],
            "row": row_data,
            "submission_uuid": str(sub.submission_uuid),
        }

        with _sync_lock:
            if settings.GOOGLE_SHEETS_SPREADSHEET_ID:
                headers, existing = _read_sheet_snapshot()
                if headers and headers != payload["headers"]:
                    raise RuntimeError("Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu; chưa ghi thêm phiếu.")
                if str(sub.submission_uuid) in existing:
                    return
            _send_webhook(payload)
            logger.info("Google Sheets đã xác nhận nhận phiếu %s.", sub.submission_uuid)

    except Exception as e:
        logger.warning(f"Lưu ý: Không thể đồng bộ phiếu lên Google Sheets: {e}")
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
        with _sync_lock:
            _send_webhook(payload, expected_status="deleted")
        logger.info("Google Sheets đã xác nhận xóa phiếu %s.", submission_uuid)
    except Exception as e:
        logger.warning(f"Lưu ý: Không thể xóa dòng tương ứng trên Google Sheets: {e}")


def trigger_google_sheets_delete(submission_uuid: str) -> None:
    """Trigger background delete from Google Sheets without blocking."""
    if settings.GOOGLE_SHEETS_WEBHOOK_URL and settings.GOOGLE_SHEETS_WEBHOOK_URL.strip():
        thread = threading.Thread(target=_delete_worker, args=(submission_uuid,), daemon=True)
        thread.start()


def resync_all_to_google_sheets(db) -> dict:
    """Append missing UUIDs and verify the destination, preserving existing rows."""
    webhook_url = settings.GOOGLE_SHEETS_WEBHOOK_URL
    if not webhook_url or not webhook_url.strip():
        return {"status": "error", "message": "Chưa cấu hình GOOGLE_SHEETS_WEBHOOK_URL"}

    try:
        with _sync_lock:
            # The dashboard counts all versions, so reconciliation must do the same.
            all_subs = db.scalars(select(Submission).order_by(Submission.created_at.asc())).all()
            sheet_headers, existing = _read_sheet_snapshot()
            expected_uuids = {str(sub.submission_uuid) for sub in all_subs}
            added_count = 0
            for sub in all_subs:
                headers, row = _submission_row(sub)
                if sheet_headers and sheet_headers != headers:
                    raise RuntimeError("Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu; chưa ghi thêm phiếu.")
                key = str(sub.submission_uuid)
                if key in existing:
                    continue
                # Individual rows also work with older deployed Apps Scripts.
                _send_webhook({"headers": headers, "row": row, "submission_uuid": key})
                existing[key] = 1
                added_count += 1

            _, actual = _read_sheet_snapshot()
            missing = expected_uuids - set(actual)
            extra = set(actual) - expected_uuids
            duplicates = sum(count - 1 for count in actual.values())
            if missing or extra or duplicates:
                raise RuntimeError(
                    f"Sheet chưa khớp CSDL: thiếu {len(missing)} phiếu, "
                    f"thừa {len(extra)} mã phiếu, {duplicates} dòng trùng."
                )
            logger.info("Đã đối chiếu %s phiếu trên Google Sheets; bổ sung %s phiếu.", len(actual), added_count)
            return {"status": "success", "count": len(actual), "added_count": added_count, "verified": True}
    except Exception as e:
        logger.warning(f"Lỗi đồng bộ Google Sheets: {e}")
        return {"status": "error", "message": str(e)}
