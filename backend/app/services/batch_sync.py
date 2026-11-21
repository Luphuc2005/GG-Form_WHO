"""Bounded, revision-checked Sheet batches with legacy webhook compatibility."""
import hashlib
import json
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update, or_, and_, bindparam, case, Boolean
from sqlalchemy.orm import selectinload
from app.database import SessionLocal
from app.config import get_settings
from app.models.submission import Submission, EXPORTABLE_STATES
from app.repositories.form_repo import FormRepository
from app.schemas.form import FormSchemaDefinition
from app.services.form_configuration import FORM_KEY
from app.services import google_sheets_svc as sheets
from app.services import record_sync as legacy

MAX_BATCH_BYTES = 1_500_000


def eligible(now):
    return or_(Submission.sync_status == "pending", (Submission.sync_status == "failed") &
               (Submission.sync_attempts < 5) & (Submission.sync_attempted_at < now-timedelta(minutes=1)))


def process_batch(factory=SessionLocal, settings=None):
    settings = settings or get_settings()
    if not settings.GOOGLE_SHEETS_WEBHOOK_URL or not settings.GOOGLE_SHEETS_SPREADSHEET_ID:
        return legacy.process_one()
    now = datetime.now(timezone.utc)
    with factory() as db:
        db.execute(update(Submission).where(Submission.sync_status == "syncing",
            Submission.sync_attempted_at < now-timedelta(minutes=5)).values(sync_status="pending"))
        db.commit()
        if db.scalar(select(Submission.id).where(eligible(now)).limit(1)) is None:
            return False
    try:
        metadata = sheets.batch_capabilities()
    except Exception:
        # The established path records a per-record actionable connection error.
        return legacy.process_one()
    if metadata is None:
        return legacy.process_one()
    with factory() as db:
        # Removals have priority and are independent of a failed schema publication.
        removing = db.scalar(select(Submission.id).where(eligible(now),
            Submission.workflow_status.not_in(EXPORTABLE_STATES)).limit(1)) is not None
        predicate = Submission.workflow_status.not_in(EXPORTABLE_STATES) if removing else Submission.workflow_status.in_(EXPORTABLE_STATES)
        rows = db.scalars(select(Submission).options(selectinload(Submission.form_version)).where(eligible(now), predicate)
            .order_by(Submission.id).limit(getattr(settings, "SHEETS_SYNC_BATCH_SIZE", 100)).with_for_update(skip_locked=True)).all()
        if not rows:
            db.commit()
            return True
        claimed_ids = set(db.scalars(update(Submission).where(eligible(now), or_(*[
            and_(Submission.id == sub.id, Submission.revision == sub.revision) for sub in rows
        ])).values(sync_status="syncing", sync_attempted_at=now, sync_attempts=Submission.sync_attempts+1)
            .returning(Submission.id), execution_options={"synchronize_session": False}))
        claimed = [(sub, sub.revision) for sub in rows if sub.id in claimed_ids]
        db.commit()
        if not claimed:
            return True
        outcomes = {}
        try:
            with sheets._sync_lock:
                # A schema job may have completed while the batch was being claimed.
                metadata = sheets.batch_capabilities()
                if metadata is None:
                    raise RuntimeError("Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.")
                current = FormRepository.get_published_by_key(db, FORM_KEY)
                schema_version = current.version if current else max(sub.form_version.version for sub, _ in claimed)
                if not removing:
                    from app.services.form_sheet_sync import ensure_schema
                    ensure_schema(db, metadata=metadata)
                else:
                    schema_version = max(schema_version, metadata.get("schema_version", 0))
                headers = metadata["headers"]
                columns = sheets.ExportService.get_columns_for_database(db) if not removing else []
                exported_headers = [column[2] for column in columns]
                keys = sheets.fit_sheet_columns(headers, exported_headers, [column[0] for column in columns])[1] if columns else []
                numeric = sheets.ExportService.numeric_labels(db) if columns else set()
                identifiers = {label for key, label, _ in columns if key in ("so_hs", "para")}
                catalogs, items = {}, []
                for sub, revision in claimed:
                    row = None
                    if not removing:
                        if sub.form_version_id not in catalogs:
                            catalogs[sub.form_version_id] = sheets.ExportService._build_maps(FormSchemaDefinition.model_validate(sub.form_version.schema_json))
                        labels, codes = catalogs[sub.form_version_id]
                        row = sheets.ExportService._flatten_submission_to_row(sub, columns, labels, codes)
                        _, row = sheets.fit_sheet_columns(headers, exported_headers, row)
                    digest = hashlib.sha256(json.dumps(row, ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
                    item = {"submission_uuid": str(sub.submission_uuid), "revision": revision, "digest": digest, "row": row}
                    if len(json.dumps(item, ensure_ascii=False).encode()) > MAX_BATCH_BYTES:
                        outcomes[item["submission_uuid"]] = {"sync_status": "failed", "sync_error": "Phiếu quá lớn để gửi trong một lô đồng bộ. Cần kiểm tra nội dung phiếu."}
                    else:
                        items.append(item)
                chunks, chunk, size = [], [], 0
                for item in items:
                    item_size = len(json.dumps(item, ensure_ascii=False).encode())
                    if chunk and size+item_size > MAX_BATCH_BYTES:
                        chunks.append(chunk); chunk, size = [], 0
                    chunk.append(item); size += item_size
                if chunk:
                    chunks.append(chunk)
                for chunk in chunks:
                    try:
                        # Long or unusually large batches renew the lease between
                        # HTTP calls so another worker cannot reclaim them mid-flight.
                        db.execute(update(Submission).where(Submission.id.in_(claimed_ids),
                            Submission.sync_status == "syncing").values(sync_attempted_at=datetime.now(timezone.utc)),
                            execution_options={"synchronize_session": False})
                        db.commit()
                        response = sheets._send_webhook({"action": "batch", "schema_version": schema_version,
                            "headers": headers, "keys": keys, "items": chunk}, expected_status="batch_synced")
                        results = response.get("results")
                        if not isinstance(results, list) or any(not isinstance(result, dict) for result in results):
                            raise RuntimeError("Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.")
                        by_key = {result.get("submission_uuid"): result for result in results}
                        if len(by_key) != len(results) or set(by_key) != {item["submission_uuid"] for item in chunk}:
                            raise RuntimeError("Google Sheets chưa xác nhận thao tác; kiểm tra bản triển khai Apps Script.")
                        for item in chunk:
                            key = item["submission_uuid"]
                            result = by_key[key]
                            expected_status = "removed" if item["row"] is None else "synced"
                            valid = result.get("revision") == item["revision"] and result.get("status") == expected_status and result.get("count") == (0 if removing else 1)
                            if not removing:
                                actual = result.get("row")
                                valid = valid and isinstance(actual, list) and all(isinstance(cell, str) for cell in actual) and sheets.same_sheet_row(headers, item["row"], actual, numeric, identifiers)
                            outcomes[key] = {"sync_status": expected_status, "synced_revision": item["revision"], "sync_error": None} if valid else {
                                "sync_status": "failed", "sync_error": "Sheet chưa xác nhận đúng phiên bản phiếu. Hệ thống sẽ thử lại; kiểm tra Sheet đích nếu lỗi lặp lại."}
                    except Exception as error:
                        for item in chunk:
                            outcomes[item["submission_uuid"]] = {"sync_status": "failed", "sync_error": legacy.sync_error_message(error)}
        except Exception as error:
            for sub, _ in claimed:
                outcomes.setdefault(str(sub.submission_uuid), {"sync_status": "failed", "sync_error": legacy.sync_error_message(error)})
        table = Submission.__table__
        # Every claim increments attempts before sending. A concurrent form
        # publication or explicit retry resets it to zero while keeping the
        # lease, requesting another pass even when answers/revision did not change.
        changed = or_(table.c.revision != bindparam("_attempt_revision"), table.c.sync_attempts == 0)
        complete = table.update().where(table.c.id == bindparam("_record_id"), table.c.sync_status == "syncing").values(
            sync_status=case((changed, "pending"), else_=bindparam("_result_status")),
            sync_error=case((changed, None), else_=bindparam("_result_error")),
            sync_attempts=case((changed, 0), else_=table.c.sync_attempts),
            synced_revision=case((and_(~changed, bindparam("_confirmed", type_=Boolean)), bindparam("_attempt_revision")), else_=table.c.synced_revision),
        )
        db.execute(complete, [{"_record_id": sub.id, "_attempt_revision": revision,
            "_result_status": outcomes[str(sub.submission_uuid)]["sync_status"],
            "_result_error": outcomes[str(sub.submission_uuid)].get("sync_error"),
            "_confirmed": "synced_revision" in outcomes[str(sub.submission_uuid)]} for sub, revision in claimed])
        db.commit()
    return True
