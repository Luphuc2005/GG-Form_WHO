"""Database-backed sync queue. A process restart does not discard pending work."""
import asyncio
import logging
import urllib.error
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update, or_
from app.database import SessionLocal
from app.config import get_settings
from app.models.submission import Submission, EXPORTABLE_STATES
from app.services import google_sheets_svc as sheets

log = logging.getLogger("record_sync")


def sync_error_message(error):
    if isinstance(error, urllib.error.HTTPError):
        return f"Kết nối Google Sheets trả lỗi HTTP {error.code}. Kiểm tra quyền và bản triển khai Apps Script, rồi thử đồng bộ lại."
    if isinstance(error, (urllib.error.URLError, TimeoutError)):
        return "Không kết nối được Google Sheets hoặc kết nối quá thời gian. Hệ thống sẽ thử lại."
    if isinstance(error, RuntimeError):
        # These service errors contain fixed operational text, never clinical values.
        messages = {
            "Google Sheets không trả về xác nhận JSON hợp lệ.",
            "Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.",
            "Không đọc được Sheet đích để xác minh dữ liệu; kiểm tra quyền truy cập.",
            "Cấu trúc cột Sheet không hợp lệ.",
            "Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu.",
            "Sheet có dòng không chứa mã phiếu UUID hợp lệ; chưa thể đối chiếu.",
            "Chưa cấu hình GOOGLE_SHEETS_WEBHOOK_TOKEN.",
            "Token hoặc Spreadsheet ID không khớp với Script Properties của Apps Script.",
            "Apps Script đang chạy bản cũ. Cập nhật mã và triển khai Phiên bản mới của Web App để đồng bộ cột.",
            "Apps Script đang chạy bản cũ và chưa đọc được Sheet để xác minh. Cập nhật mã và triển khai Phiên bản mới của Web App.",
        }
        if str(error) in messages:
            return str(error)
    return "Chưa xác minh được dữ liệu trên Sheet. Hệ thống sẽ thử lại; bác sĩ có thể yêu cầu đồng bộ lại."


def process_one():
    settings = get_settings()
    if not settings.GOOGLE_SHEETS_WEBHOOK_URL or not settings.GOOGLE_SHEETS_SPREADSHEET_ID:
        with SessionLocal() as db:
            db.execute(update(Submission).where(Submission.sync_status == "pending").values(sync_status="not_configured", sync_error="Chưa cấu hình đầy đủ kết nối Google Sheets. Phiếu vẫn được lưu trong hệ thống."))
            db.commit()
        return False
    now = datetime.now(timezone.utc)
    with SessionLocal() as db:
        # Recover jobs interrupted by shutdown; back off failed attempts, capped at 5.
        db.execute(update(Submission).where(Submission.sync_status == "syncing", Submission.sync_attempted_at < now-timedelta(minutes=5)).values(sync_status="pending"))
        db.commit()
        sub = db.scalar(select(Submission).where(or_(
            Submission.sync_status == "pending",
            (Submission.sync_status == "failed") & (Submission.sync_attempts < 5) & (Submission.sync_attempted_at < now-timedelta(minutes=1)),
        )).order_by(Submission.id).limit(1))
        if not sub:
            return False
        sub_id, revision = sub.id, sub.revision
        claimed = db.execute(update(Submission).where(Submission.id == sub_id, Submission.revision == revision, Submission.sync_status.in_(("pending", "failed"))).values(sync_status="syncing", sync_attempted_at=now, sync_attempts=Submission.sync_attempts+1), execution_options={"synchronize_session": False}).rowcount
        db.commit()
        if claimed != 1:
            return True
        db.refresh(sub)
        try:
            with sheets._sync_lock:
                from app.services.form_sheet_sync import ensure_schema
                ensure_schema(db)
                headers, existing, snapshot_rows = sheets._read_sheet_data()
                key = str(sub.submission_uuid)
                publishable = sub.workflow_status in EXPORTABLE_STATES
                expected_headers, row = sheets._submission_row(sub)
                if publishable:
                    expected_headers, row = sheets.fit_sheet_columns(headers, expected_headers, row)
                # Reconciliation must not rewrite an already verified revision.
                # This also restores status for records sent before tracking existed.
                matching = [r for r in snapshot_rows if r and r[0].strip() == key]
                numeric_labels = sheets.ExportService.numeric_labels(db)
                identifier_labels = {label for field_key, label, _ in sheets.ExportService.get_columns_for_database(db) if field_key in ("so_hs", "para")}
                unchanged = publishable and existing[key] == 1 and len(matching) == 1 and sheets.same_sheet_row(expected_headers, row, matching[0], numeric_labels, identifier_labels)
                if unchanged:
                    actual, rows = existing, snapshot_rows
                else:
                    # The legacy webhook supports replacement through delete-and-append.
                    for _ in range(existing[key]):
                        sheets._send_webhook({"action": "delete", "submission_uuid": key}, expected_status="deleted")
                        _, remaining, _ = sheets._read_sheet_data()
                        if remaining[key] == 0:
                            break
                    if publishable:
                        sheets._send_webhook({"headers": expected_headers, "row": row, "submission_uuid": key})
                    _, actual, rows = sheets._read_sheet_data()
                if actual[key] != (1 if publishable else 0):
                    raise RuntimeError("Destination did not confirm expected UUID count")
                if publishable:
                    actual_row = next(r for r in rows if r and r[0].strip() == key)
                    if not sheets.same_sheet_row(expected_headers, row, actual_row, numeric_labels, identifier_labels):
                        raise RuntimeError("Destination content differs from sent revision")
            result = {"sync_status": "synced" if publishable else "removed", "sync_error": None, "synced_revision": revision}
        except Exception as error:
            # Do not leak hospital data, webhook URLs or credentials into the browser/log.
            result = {"sync_status": "failed", "sync_error": sync_error_message(error)}
            log.warning("Sheet sync failed for record %s (%s), attempt will be retried.", sub_id, type(error).__name__)
        db.refresh(sub)
        if sub.revision != revision:
            result = {"sync_status": "pending", "sync_error": None, "sync_attempts": 0}
        db.execute(update(Submission).where(Submission.id == sub_id, Submission.sync_status == "syncing").values(**result))
        db.commit()
    return True


async def sync_loop():
    while True:
        try:
            from app.services.form_sheet_sync import process_schema_job
            await asyncio.to_thread(process_schema_job, SessionLocal, get_settings())
            more = await asyncio.to_thread(process_one)
        except Exception:
            log.warning("Sync queue unavailable; retrying later.")
            more = False
        await asyncio.sleep(1 if more else 10)
