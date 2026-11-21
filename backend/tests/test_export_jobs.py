"""Queued Excel creation, ownership, expiry and recovery with private files."""
from contextlib import contextmanager
from datetime import datetime, timezone, timedelta
from pathlib import Path
import io
from openpyxl import load_workbook
from sqlalchemy import select
from app.config import get_settings
from app.models.export_job import ExportJob
from app.services import export_jobs as service
from tests.test_workflow import actors, draft, save, complete, act


def environment(db_session, monkeypatch, tmp_path):
    settings = get_settings()
    monkeypatch.setattr(settings, "EXPORT_DIR", str(tmp_path))
    @contextmanager
    def factory():
        yield db_session
    return factory, settings


def test_export_request_returns_before_generation_then_downloads_owned_file(client, actors, db_session, monkeypatch, tmp_path):
    factory, settings = environment(db_session, monkeypatch, tmp_path)
    record = draft(client, actors["trainee_a"])
    record = save(client, actors["trainee_a"], record, complete(record))
    record = act(client, actors["trainee_a"], record, "submit").json()
    assert client.post("/api/v1/admin/exports").status_code == 401
    assert client.post("/api/v1/admin/exports", headers=actors["trainee_a"]).status_code == 403
    response = client.post("/api/v1/admin/exports", headers=actors["admin"])
    assert response.status_code == 202
    job = response.json()
    assert job["status"] == "pending" and job["download_url"] is None
    assert not list(tmp_path.iterdir())
    assert client.post("/api/v1/admin/exports", headers=actors["admin"]).json()["id"] == job["id"]
    url = f"/api/v1/admin/exports/{job['id']}"
    assert client.get(url, headers=actors["physician"]).status_code == 404
    assert client.get(url+"/download", headers=actors["admin"]).status_code == 409
    assert service.process_one(factory, settings)
    status = client.get(url, headers=actors["admin"]).json()
    assert status["status"] == "ready" and status["row_count"] == 1
    assert status["total_rows"] == 1 and status["size_bytes"] > 0
    download = client.get(status["download_url"], headers=actors["admin"])
    assert download.status_code == 200 and download.headers["cache-control"] == "no-store"
    workbook = load_workbook(io.BytesIO(download.content))
    assert workbook.active.max_row == 2
    assert record["study_code"] in [cell.value for cell in workbook.active[2]]
    assert client.get(status["download_url"], headers=actors["physician"]).status_code == 404
    assert not service.process_one(factory, settings)
    expired = db_session.get(ExportJob, job["id"])
    path = service.storage_path(settings, expired.storage_key)
    expired.expires_at = datetime.now(timezone.utc)-timedelta(seconds=1)
    db_session.commit()
    assert client.get(status["download_url"], headers=actors["admin"]).status_code == 410
    service.expire_files(factory, settings)
    assert not path.exists()
    assert client.get(url, headers=actors["admin"]).json()["status"] == "expired"


def test_new_exports_exclude_trash_and_cancelled_and_recover_interrupted_work(client, actors, db_session, monkeypatch, tmp_path):
    factory, settings = environment(db_session, monkeypatch, tmp_path)
    record = draft(client, actors["trainee_a"])
    record = save(client, actors["trainee_a"], record, complete(record))
    record = act(client, actors["trainee_a"], record, "submit").json()
    assert client.post(f"/api/v1/records/{record['submission_uuid']}/trash", headers=actors["admin"], json={"revision":record["revision"]}).status_code == 200
    response = client.post("/api/v1/admin/exports", headers=actors["admin"])
    job = db_session.get(ExportJob, response.json()["id"])
    job.status = "running"
    job.attempts = 1
    job.started_at = datetime.now(timezone.utc)-timedelta(minutes=31)
    db_session.commit()
    assert service.process_one(factory, settings)
    status = client.get(f"/api/v1/admin/exports/{job.id}", headers=actors["admin"]).json()
    assert status["status"] == "ready" and status["row_count"] == 0
    db_session.refresh(job)
    assert job.attempts == 2
    data = client.get(status["download_url"], headers=actors["admin"])
    assert load_workbook(io.BytesIO(data.content)).active.max_row == 1


def test_export_failure_never_publishes_partial_file(client, actors, db_session, monkeypatch, tmp_path):
    factory, settings = environment(db_session, monkeypatch, tmp_path)
    job = client.post("/api/v1/admin/exports", headers=actors["admin"]).json()
    def fail(_db, output, on_progress):
        output.write(b"partial-synthetic")
        on_progress(1)
        raise RuntimeError("https://synthetic-secret.invalid/private")
    monkeypatch.setattr(service.ExportService, "xlsx_file", fail)
    assert service.process_one(factory, settings)
    status = client.get(f"/api/v1/admin/exports/{job['id']}", headers=actors["admin"]).json()
    assert status["status"] == "failed" and status["download_url"] is None
    assert "secret" not in status["error"]
    assert not list(tmp_path.iterdir())


def test_invalid_storage_keys_cannot_escape_export_directory(tmp_path):
    from types import SimpleNamespace
    import pytest
    settings = SimpleNamespace(EXPORT_DIR=str(tmp_path))
    with pytest.raises(ValueError):
        service.storage_path(settings, "../private.xlsx")


def test_locked_progress_file_does_not_fail_excel_creation(client, actors, db_session, monkeypatch, tmp_path):
    factory, settings = environment(db_session, monkeypatch, tmp_path)
    original = Path.replace
    def locked(self, target):
        if str(target).endswith(".progress"):
            raise PermissionError("Synthetic concurrent Windows reader")
        return original(self, target)
    monkeypatch.setattr(Path, "replace", locked)
    job = client.post("/api/v1/admin/exports", headers=actors["admin"]).json()
    assert service.process_one(factory, settings)
    status = client.get(f"/api/v1/admin/exports/{job['id']}", headers=actors["admin"]).json()
    assert status["status"] == "ready"
    assert client.get(status["download_url"], headers=actors["admin"]).status_code == 200
