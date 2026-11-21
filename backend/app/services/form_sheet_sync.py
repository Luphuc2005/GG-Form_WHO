"""Durable schema synchronization, independent of whether any records exist."""
from datetime import datetime, timezone, timedelta
from sqlalchemy import update, select, or_
from app.models.submission import Submission, EXPORTABLE_STATES
from app.models.form_management import FormSheetJob
from app.repositories.form_repo import FormRepository
from app.services.form_configuration import FORM_KEY, export_definitions
from app.services.clinical_validation import SURGERY_FIELDS
from app.services import google_sheets_svc as sheets


def ensure_schema(db, metadata=None):
    definitions, managed = export_definitions(db)
    additions = []
    empty_destination = metadata is not None and not metadata["headers"]
    if not managed and not empty_destination:
        # Append collected additions while preserving a hospital's trimmed layout.
        # The surgical protocol adds its switches and descriptions together.
        for group in (("sa_ket_luan",), SURGERY_FIELDS):
            values = [Submission.answers["clinical_data"][key].as_string() for key in group]
            collected = db.scalar(select(Submission.id).where(
                Submission.workflow_status.in_(EXPORTABLE_STATES),
                or_(*[value.is_not(None) & (value != "") for value in values]),
            ).limit(1))
            if collected is not None:
                additions.extend(group)
        if not additions:
            return
    current = FormRepository.get_published_by_key(db, FORM_KEY)
    if metadata is None:
        headers, _, _ = sheets._read_sheet_data()
        layout_version, layout_applied = sheets._sheet_layout_version, sheets._sheet_layout_applied
    else:
        headers = metadata["headers"]
        layout_version, layout_applied = metadata.get("layout_version", 0), metadata.get("layout_applied", False)
    if not managed and not empty_destination:
        missing = [d for d in definitions if d["key"] in additions and d["export"] and d["label"] not in headers]
        if not headers or not missing:
            return
        exported = [d for d in definitions if d["export"]]
        _, positions = sheets.fit_sheet_columns(headers, [d["label"] for d in exported], list(range(len(exported))))
        definitions = [{**exported[index], "label": label, "aliases": [label]} for label, index in zip(headers, positions)]
        definitions.extend(missing)
    expected = [d["label"] for d in definitions if d["export"]]
    ordered_layout = managed and layout_version >= 1
    if (headers == expected and layout_applied if ordered_layout else len(headers) == len(expected) and set(headers) == set(expected)):
        return
    sheets._send_webhook({"action": "schema", "schema_version": current.version, "columns": definitions,
                         "preserve_column_order": not managed, "organize_columns": managed}, expected_status="schema_updated")
    if metadata is None:
        actual, _, _ = sheets._read_sheet_data()
    else:
        updated = sheets.batch_capabilities()
        if updated is None:
            raise RuntimeError("Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.")
        metadata.update(updated)
        actual = updated["headers"]
    if (actual != expected if ordered_layout else len(actual) != len(expected) or set(actual) != set(expected)):
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
            except Exception as error:
                from app.services.record_sync import sync_error_message
                result = {"status": "failed", "error": sync_error_message(error)}
        completed = db.execute(update(FormSheetJob).where(FormSheetJob.form_key == FORM_KEY, FormSheetJob.target_version == version,
            FormSheetJob.status == "syncing", FormSheetJob.attempts == attempts+1).values(**result))
        if completed.rowcount == 1 and result["status"] == "synced":
            # A shared schema failure may have exhausted row retries. Once the
            # schema is verified, release those records, including removals.
            db.execute(update(Submission).where(Submission.sync_status == "failed").values(
                sync_status="pending", sync_attempts=0, sync_error=None,
            ))
        db.commit()
        return True
