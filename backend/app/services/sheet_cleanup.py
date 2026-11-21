"""Clean up only reviewed orphan rows; archive every value before any deletion."""
import hashlib
import json
import uuid
from collections import Counter, defaultdict
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update, or_
from app.core.exceptions import ConflictException
from app.models.submission import Submission
from app.models.sheet_cleanup import SheetCleanupJob
from app.services import google_sheets_svc as sheets

CHANGED = "Các dòng cũ trên Sheet đã thay đổi. Bấm Đồng bộ lại để đối chiếu trước khi dọn."


def orphan_snapshot(db):
    headers, _, rows = sheets._read_sheet_data()
    local = {str(key) for key in db.scalars(select(Submission.submission_uuid))}
    snapshot = {"spreadsheet_id": sheets.settings.GOOGLE_SHEETS_SPREADSHEET_ID.strip(),
                "headers": headers, "rows": [row for row in rows if row and any(cell.strip() for cell in row) and str(uuid.UUID(row[0].strip())) not in local]}
    digest = hashlib.sha256(json.dumps(snapshot, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    return snapshot, digest


def queue_cleanup(db, preview_hash, username):
    with sheets._sync_lock:
        snapshot, current_hash = orphan_snapshot(db)
        if preview_hash != current_hash:
            raise ConflictException(CHANGED)
        if not snapshot["rows"]:
            raise ConflictException("Không còn dòng cũ cần dọn trên Sheet.")
        active = db.scalar(select(SheetCleanupJob.id).where(SheetCleanupJob.status.in_(("pending", "syncing"))))
        if active:
            raise ConflictException("Đang có yêu cầu dọn Sheet. Chờ hoàn tất trước khi gửi lại.")
        job = SheetCleanupJob(snapshot=snapshot, requested_by=username)
        db.add(job)
        # The backup must be durable before the worker can delete anything.
        db.commit()
        db.refresh(job)
        return job


def present_job(job):
    if job is None:
        return None
    return {"id": job.id, "status": job.status, "count": len(job.snapshot["rows"]),
            "removed_count": job.removed_count, "retained_count": job.retained_count,
            "error": job.error, "created_at": job.created_at,
            "backup_url": f"/api/v1/admin/google-sheets/cleanup/{job.id}/backup.csv"}


def process_cleanup_job(factory, settings):
    if not settings.GOOGLE_SHEETS_WEBHOOK_URL or not settings.GOOGLE_SHEETS_SPREADSHEET_ID:
        with factory() as db:
            db.execute(update(SheetCleanupJob).where(SheetCleanupJob.status == "pending").values(
                status="not_configured", error="Chưa cấu hình đầy đủ kết nối Google Sheets. Bản sao lưu vẫn được giữ lại.",
            ))
            db.commit()
        return False
    now = datetime.now(timezone.utc)
    with factory() as db:
        db.execute(update(SheetCleanupJob).where(SheetCleanupJob.status == "syncing",
            SheetCleanupJob.attempted_at < now-timedelta(minutes=5)).values(status="pending"))
        db.commit()
        job = db.scalar(select(SheetCleanupJob).where(or_(SheetCleanupJob.status == "pending",
            (SheetCleanupJob.status == "failed") & (SheetCleanupJob.attempts < 5) & (SheetCleanupJob.attempted_at < now-timedelta(minutes=1))
        )).order_by(SheetCleanupJob.id).limit(1))
        if job is None:
            return False
        claimed = db.execute(update(SheetCleanupJob).where(SheetCleanupJob.id == job.id,
            SheetCleanupJob.status == job.status, SheetCleanupJob.attempts == job.attempts
        ).values(status="syncing", attempts=job.attempts+1, attempted_at=now), execution_options={"synchronize_session": False}).rowcount
        db.commit()
        if claimed != 1:
            return True
        result = {"status": "synced", "error": None}
        try:
            with sheets._sync_lock:
                archived = job.snapshot
                if archived["spreadsheet_id"] != settings.GOOGLE_SHEETS_SPREADSHEET_ID.strip():
                    raise RuntimeError("Sheet đích đã thay đổi; yêu cầu dọn cũ được giữ lại cùng bản sao lưu.")
                headers, _, rows = sheets._read_sheet_data()
                by_key = defaultdict(list)
                for row in archived["rows"]:
                    by_key[str(uuid.UUID(row[0].strip()))].append(row)
                current = defaultdict(list)
                for row in rows:
                    if row and row[0].strip():
                        current[str(uuid.UUID(row[0].strip()))].append(row)
                local = {str(key) for key in db.scalars(select(Submission.submission_uuid))}
                for key, old_rows in by_key.items():
                    if key in local or not current[key]:
                        continue
                    if headers != archived["headers"] or Counter(map(tuple, current[key])) != Counter(map(tuple, old_rows)):
                        raise ConflictException(CHANGED)
                for key in by_key:
                    # A record imported since the preview must never be deleted.
                    if db.scalar(select(Submission.id).where(Submission.submission_uuid == uuid.UUID(key))) is not None:
                        continue
                    for _ in range(len(current[key])):
                        sheets._send_webhook({"action": "delete", "submission_uuid": key}, expected_status="deleted")
                        _, remaining, _ = sheets._read_sheet_data()
                        if remaining[key] == 0:
                            break
                    if current[key] and remaining[key]:
                        raise RuntimeError("Sheet chưa xác nhận đã gỡ các dòng cũ.")
                _, actual, _ = sheets._read_sheet_data()
                local = {str(key) for key in db.scalars(select(Submission.submission_uuid))}
                if any(actual[key] for key in by_key if key not in local):
                    raise RuntimeError("Sheet chưa xác nhận đã gỡ các dòng cũ.")
                result.update(removed_count=sum(len(value) for key, value in by_key.items() if not actual[key]),
                              retained_count=sum(len(value) for key, value in by_key.items() if key in local and actual[key]))
        except ConflictException:
            result = {"status": "failed", "error": CHANGED, "attempts": 5}
        except Exception as error:
            from app.services.record_sync import sync_error_message
            result = {"status": "failed", "error": sync_error_message(error)}
        db.execute(update(SheetCleanupJob).where(SheetCleanupJob.id == job.id, SheetCleanupJob.status == "syncing").values(**result))
        db.commit()
    return True
