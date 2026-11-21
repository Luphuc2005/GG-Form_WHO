"""Legacy deletions are previewed, backed up, durable and verified remotely."""
import csv
import io
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import select

from app.core.exceptions import ConflictException
from app.models.submission import Submission
from app.models.sheet_cleanup import SheetCleanupJob
from app.services import sheet_cleanup as cleanup
from tests.test_record_sync import sync_env
from tests.test_workflow import actors


def add_orphan(destination, value="SYNTHETIC-LEGACY"):
    row = [str(uuid.uuid4()), value] + [""] * (len(destination.headers)-2)
    destination.rows.append(row)
    return row


def enqueue(factory):
    with factory() as db:
        snapshot, digest = cleanup.orphan_snapshot(db)
        job = cleanup.queue_cleanup(db, digest, "synthetic-admin")
        return job.id, snapshot


def test_cleanup_archives_before_deleting_and_preserves_existing_records(sync_env):
    from app.services.record_sync import process_one
    factory, destination, key, config = sync_env
    assert process_one()
    known = destination.rows[0][:]
    orphan = add_orphan(destination)
    identifier, snapshot = enqueue(factory)
    assert snapshot["rows"] == [orphan]
    assert destination.rows == [known, orphan]  # Enqueue never deletes.
    with factory() as db:
        assert db.get(SheetCleanupJob, identifier).snapshot == snapshot
    assert cleanup.process_cleanup_job(factory, config)
    assert destination.rows == [known]
    with factory() as db:
        job = db.get(SheetCleanupJob, identifier)
        assert job.status == "synced" and job.removed_count == 1
        assert job.snapshot["rows"] == [orphan]
    assert not cleanup.process_cleanup_job(factory, config)


def test_stale_preview_is_rejected_before_any_backup_or_delete(sync_env):
    factory, destination, _, _ = sync_env
    orphan = add_orphan(destination)
    with factory() as db:
        _, digest = cleanup.orphan_snapshot(db)
        orphan[1] = "CHANGED-SINCE-PREVIEW"
        with pytest.raises(ConflictException):
            cleanup.queue_cleanup(db, digest, "synthetic-admin")
        assert db.scalar(select(SheetCleanupJob.id)) is None
    assert destination.posts == 0


def test_cleanup_retries_after_partial_failure_without_losing_backup(sync_env, monkeypatch):
    factory, destination, _, config = sync_env
    first, second = add_orphan(destination), add_orphan(destination)
    identifier, _ = enqueue(factory)
    original = destination.open
    def fail_second(request, timeout):
        if len(destination.rows) == 1 and b'"action": "delete"' in request.data:
            raise TimeoutError("synthetic")
        return original(request, timeout)
    monkeypatch.setattr(cleanup.sheets.urllib.request, "urlopen", fail_second)
    assert cleanup.process_cleanup_job(factory, config)
    assert destination.rows == [second]
    with factory() as db:
        job = db.get(SheetCleanupJob, identifier)
        assert job.status == "failed" and job.snapshot["rows"] == [first, second]
        job.attempted_at = datetime.now(timezone.utc)-timedelta(minutes=2)
        db.commit()
    monkeypatch.setattr(cleanup.sheets.urllib.request, "urlopen", original)
    assert cleanup.process_cleanup_job(factory, config)
    assert destination.rows == []
    with factory() as db:
        job = db.get(SheetCleanupJob, identifier)
        assert job.status == "synced" and job.removed_count == 2


def test_changes_after_enqueue_stop_cleanup_and_require_new_review(sync_env):
    factory, destination, _, config = sync_env
    orphan = add_orphan(destination)
    identifier, _ = enqueue(factory)
    orphan[1] = "CHANGED-AFTER-ENQUEUE"
    assert cleanup.process_cleanup_job(factory, config)
    assert destination.rows == [orphan] and destination.posts == 0
    with factory() as db:
        job = db.get(SheetCleanupJob, identifier)
        assert job.status == "failed" and job.attempts == 5


def test_newly_imported_record_and_unreviewed_rows_are_preserved(sync_env):
    factory, destination, key, config = sync_env
    orphan = add_orphan(destination)
    identifier, _ = enqueue(factory)
    unreviewed = add_orphan(destination)
    with factory() as db:
        db.get(Submission, key).submission_uuid = uuid.UUID(orphan[0])
        db.commit()
    assert cleanup.process_cleanup_job(factory, config)
    assert destination.rows == [orphan, unreviewed]
    with factory() as db:
        job = db.get(SheetCleanupJob, identifier)
        assert job.status == "synced" and job.removed_count == 0 and job.retained_count == 1


def test_silent_delete_success_is_not_marked_complete(sync_env):
    factory, destination, _, config = sync_env
    add_orphan(destination)
    identifier, _ = enqueue(factory)
    destination.ignore = True
    assert cleanup.process_cleanup_job(factory, config)
    with factory() as db:
        assert db.get(SheetCleanupJob, identifier).status == "failed"
    assert len(destination.rows) == 1


def test_missing_configuration_retains_backup_and_reports_actionable_status(sync_env):
    factory, destination, _, config = sync_env
    add_orphan(destination)
    identifier, snapshot = enqueue(factory)
    config.GOOGLE_SHEETS_WEBHOOK_URL = ""
    assert not cleanup.process_cleanup_job(factory, config)
    with factory() as db:
        job = db.get(SheetCleanupJob, identifier)
        assert job.status == "not_configured" and job.snapshot == snapshot
    assert len(destination.rows) == 1


def test_api_requires_admin_and_backup_is_downloadable_and_formula_safe(client, actors, db_session, monkeypatch):
    snapshot = {"spreadsheet_id": "synthetic", "headers": ["ID", "Content"],
                "rows": [[str(uuid.uuid4()), "=SYNTHETIC()"]]}
    monkeypatch.setattr(cleanup, "orphan_snapshot", lambda _: (snapshot, "a"*64))
    path = "/api/v1/admin/google-sheets/cleanup"
    assert client.post(path, json={"preview_hash": "a"*64}).status_code == 401
    assert client.post(path, headers=actors["trainee_a"], json={"preview_hash": "a"*64}).status_code == 403
    response = client.post(path, headers=actors["admin"], json={"preview_hash": "a"*64})
    assert response.status_code == 200
    job = response.json()
    assert job["status"] == "pending" and job["count"] == 1
    assert client.get(path+"/latest", headers=actors["admin"]).json()["id"] == job["id"]
    backup = client.get(job["backup_url"], headers=actors["admin"])
    assert backup.status_code == 200
    rows = list(csv.reader(io.StringIO(backup.content.decode("utf-8-sig"))))
    assert rows[1][1] == "'=SYNTHETIC()"
    assert client.get(job["backup_url"], headers=actors["trainee_a"]).status_code == 403
    assert client.post(path, headers=actors["admin"], json={"preview_hash": "a"*64}).status_code == 409
