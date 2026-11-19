"""Durable sync behavior tested against a fake destination only."""
import io
import json
import uuid
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.services import record_sync as worker
from app.services import google_sheets_svc as sheets
from app.services.export_svc import FORM_COLUMNS


class Response(io.BytesIO):
    def __init__(self, body, content_type="application/json"):
        super().__init__(body)
        self.headers = {"Content-Type": content_type}


class FakeDestination:
    def __init__(self):
        self.rows = []
        self.headers = [label for _, label in FORM_COLUMNS]
        self.fail = False
        self.ignore = False
        self.posts = 0

    def open(self, request, timeout):
        assert request.get_method() == "POST"
        payload = json.loads(request.data)
        assert payload["token"] == "synthetic-token"
        assert payload["spreadsheet_id"] == "synthetic"
        if payload.get("action") == "snapshot":
            rows = [[str(cell) if cell is not None else "" for cell in row]
                    for row in [self.headers, *self.rows]]
            return Response(json.dumps({"status": "snapshot", "rows": rows}).encode())
        self.posts += 1
        if self.fail:
            raise OSError("Synthetic network failure")
        if payload.get("action") == "schema":
            columns = payload["columns"]
            previous_keys = [next(c["key"] for c in columns if label in c["aliases"]) for label in self.headers]
            exported = [c for c in columns if c["export"]]
            self.rows = [[dict(zip(previous_keys, row)).get(c["key"], "") for c in exported] for row in self.rows]
            self.headers = [c["label"] for c in exported]
            return Response(b'{"status":"schema_updated"}')
        deleting = payload.get("action") == "delete"
        if not self.ignore:
            if deleting:
                self.rows = [r for r in self.rows if r[0] != payload["submission_uuid"]]
            else:
                self.rows.append(payload["row"])
        return Response(json.dumps({"status": "deleted" if deleting else "success"}).encode())


@pytest.fixture
def sync_env(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    config = SimpleNamespace(
        GOOGLE_SHEETS_WEBHOOK_URL="https://example.invalid/synthetic",
        GOOGLE_SHEETS_SPREADSHEET_ID="synthetic",
        GOOGLE_SHEETS_WEBHOOK_TOKEN="synthetic-token",
    )
    destination = FakeDestination()
    monkeypatch.setattr(worker, "SessionLocal", factory)
    monkeypatch.setattr(worker, "get_settings", lambda: config)
    monkeypatch.setattr(sheets, "settings", config)
    monkeypatch.setattr(sheets.urllib.request, "urlopen", destination.open)
    with factory() as db:
        form = FormVersion(form_key="ovarian-pathology-who", version=1, schema_hash="synthetic", schema_json={"form_key":"ovarian-pathology-who", "version":1, "title":"Synthetic", "fields":[]})
        db.add(form); db.flush()
        sub = Submission(submission_uuid=uuid.uuid4(), form_version_id=form.id, answers={"clinical_data":{"so_hs":"SYNTHETIC"}}, payload_hash="synthetic", classification="unspecified", workflow_status="submitted", revision=3, sync_status="pending")
        db.add(sub); db.commit(); key = sub.id
    yield factory, destination, key, config
    engine.dispose()


def test_failed_job_survives_and_retries_once_destination_recovers(sync_env):
    factory, destination, key, _ = sync_env
    destination.fail = True
    assert worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "failed" and sub.sync_attempts == 1
        sub.sync_attempted_at = datetime.now(timezone.utc)-timedelta(minutes=2)
        db.commit()
    destination.fail = False
    assert worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "synced" and sub.synced_revision == 3
    assert len(destination.rows) == 1
    assert not worker.process_one()  # No repeated append after success.


def test_surgical_protocol_extends_legacy_sheet_and_verifies_all_new_values(sync_env):
    from app.services.clinical_validation import CONTRACT, SURGERY_DETAILS, SURGERY_FIELDS

    factory, destination, key, _ = sync_env
    new_labels = {CONTRACT["fields"][field] for field in SURGERY_FIELDS}
    destination.headers = [label for label in destination.headers if label not in new_labels]
    original_headers = destination.headers[:]
    unrelated_row = [str(uuid.uuid4()), "SYNTHETIC-OTHER"] + [""] * (len(original_headers) - 2)
    destination.rows = [unrelated_row[:]]
    values = {"pt_so_luong_u": "2 bên"}
    for index, (parent, detail) in enumerate(SURGERY_DETAILS.items()):
        values.update({parent: "Có", detail: f"Synthetic surgical finding {index}"})
    with factory() as db:
        record = db.get(Submission, key)
        record.answers = {"clinical_data": {"so_hs": "SYNTHETIC", **values}}
        db.commit()
    assert worker.process_one()
    assert destination.headers[:len(original_headers)] == original_headers
    assert destination.headers[len(original_headers):] == [CONTRACT["fields"][field] for field in SURGERY_FIELDS]
    assert destination.rows[0][:len(unrelated_row)] == unrelated_row
    with factory() as db:
        record = db.get(Submission, key)
        assert record.sync_status == "synced" and record.synced_revision == record.revision
        row = next(row for row in destination.rows if row[0] == str(record.submission_uuid))
        for field, value in values.items():
            assert row[destination.headers.index(CONTRACT["fields"][field])] == value
    writes = destination.posts
    assert not worker.process_one()
    assert destination.posts == writes and len(destination.rows) == 2


def test_original_biomarker_units_append_without_relabeling_historical_numbers(sync_env):
    from app.services.biomarker_units import BIOMARKER_UNIT_FIELDS
    from app.services.clinical_validation import CONTRACT

    factory, destination, key, _ = sync_env
    new_labels = {CONTRACT["fields"][field] for field in BIOMARKER_UNIT_FIELDS}
    destination.headers = [label for label in destination.headers if label not in new_labels]
    original_headers = destination.headers[:]
    unrelated = [""] * len(original_headers)
    unrelated[0] = str(uuid.uuid4())
    unrelated[original_headers.index("AFP")] = "123.000"
    destination.rows = [unrelated[:]]
    values = {"afp": "12.500", "afp_unit": "IU/mL", "he4": "21.5", "he4_unit": "Khác", "he4_unit_other": "Synthetic original unit"}
    with factory() as db:
        record = db.get(Submission, key)
        record.answers = {"clinical_data": {"so_hs": "SYNTHETIC", **values}}
        db.commit()
    assert worker.process_one()
    assert destination.headers[:len(original_headers)] == original_headers
    assert destination.headers[len(original_headers):] == [CONTRACT["fields"][field] for field in BIOMARKER_UNIT_FIELDS]
    assert destination.rows[0][:len(unrelated)] == unrelated
    assert all(destination.rows[0][destination.headers.index(label)] == "" for label in new_labels)
    with factory() as db:
        record = db.get(Submission, key)
        assert record.sync_status == "synced"
        row = next(row for row in destination.rows if row[0] == str(record.submission_uuid))
        for field, value in values.items():
            assert row[destination.headers.index(CONTRACT["fields"][field])] == value
    writes = destination.posts
    assert not worker.process_one() and destination.posts == writes


def test_cancelled_record_is_removed_but_database_row_remains(sync_env):
    factory, destination, key, _ = sync_env
    worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        sub.workflow_status, sub.sync_status, sub.revision = "cancelled", "pending", 4
        db.commit()
    worker.process_one()
    assert destination.rows == []
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub is not None and sub.sync_status == "removed" and sub.synced_revision == 4


def test_trash_then_restore_removes_and_republishes_the_same_uuid(sync_env):
    factory, destination, key, _ = sync_env
    assert worker.process_one()
    original = list(destination.rows[0])
    with factory() as db:
        sub = db.get(Submission, key)
        sub.trashed_from_state = sub.workflow_status
        sub.workflow_status, sub.sync_status, sub.revision = "trashed", "pending", 4
        db.commit()
    assert worker.process_one()
    assert destination.rows == []
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "removed"
        sub.workflow_status, sub.sync_status, sub.revision = sub.trashed_from_state, "pending", 5
        sub.trashed_from_state = None
        db.commit()
    assert worker.process_one()
    assert destination.rows == [original]
    assert not worker.process_one()


def test_trash_during_an_inflight_write_is_reconciled_on_the_next_job(sync_env, monkeypatch):
    factory, destination, key, _ = sync_env
    original_open = destination.open

    def trash_after_append(request, timeout):
        response = original_open(request, timeout)
        payload = json.loads(request.data)
        if "row" in payload:
            with factory() as db:
                sub = db.get(Submission, key)
                sub.trashed_from_state = "submitted"
                sub.workflow_status, sub.revision = "trashed", sub.revision + 1
                db.commit()
        return response

    monkeypatch.setattr(sheets.urllib.request, "urlopen", trash_after_append)
    assert worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.workflow_status == "trashed" and sub.sync_status == "pending"
    assert worker.process_one()
    assert destination.rows == []


def test_edited_sent_revision_replaces_the_existing_row(sync_env):
    factory, destination, key, _ = sync_env
    worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        sub.answers = {"clinical_data":{"so_hs":"SYNTHETIC-UPDATED"}}
        sub.revision, sub.sync_status = 4, "pending"
        db.commit()
    worker.process_one()
    assert len(destination.rows) == 1
    assert any("SYNTHETIC-UPDATED" in str(cell) for cell in destination.rows[0])


def test_resync_existing_identical_row_verifies_without_rewriting(sync_env):
    factory, destination, key, _ = sync_env
    worker.process_one()
    writes = destination.posts
    with factory() as db:
        sub = db.get(Submission, key)
        sub.sync_status, sub.synced_revision = "pending", None
        db.commit()
    destination.fail = True  # Verification requires no POST if the row already matches.
    assert worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "synced" and sub.synced_revision == 3
    assert destination.posts == writes
    assert len(destination.rows) == 1


def test_sync_errors_are_actionable_without_leaking_request_urls():
    import urllib.error
    error = urllib.error.HTTPError("https://example.invalid/secret", 403, "sensitive", {}, None)
    message = worker.sync_error_message(error)
    assert "HTTP 403" in message and "secret" not in message and "sensitive" not in message
    assert "secret" not in worker.sync_error_message(RuntimeError("secret clinical value"))


def test_acknowledged_but_ignored_write_is_not_marked_synced(sync_env):
    factory, destination, key, _ = sync_env
    worker.process_one()
    destination.ignore = True
    with factory() as db:
        sub = db.get(Submission, key)
        sub.answers = {"clinical_data":{"so_hs":"SYNTHETIC-UPDATED"}}
        sub.revision, sub.sync_status = 4, "pending"
        db.commit()
    worker.process_one()
    with factory() as db:
        assert db.get(Submission, key).sync_status == "failed"


def test_interrupted_worker_is_recovered_from_database(sync_env):
    factory, destination, key, _ = sync_env
    with factory() as db:
        sub = db.get(Submission, key)
        sub.sync_status = "syncing"
        sub.sync_attempted_at = datetime.now(timezone.utc)-timedelta(minutes=6)
        db.commit()
    worker.process_one()
    assert len(destination.rows) == 1
    with factory() as db:
        assert db.get(Submission, key).sync_status == "synced"


def test_missing_configuration_keeps_patient_record_and_reports_status(sync_env):
    factory, destination, key, config = sync_env
    config.GOOGLE_SHEETS_SPREADSHEET_ID = ""
    worker.process_one()
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub is not None and sub.sync_status == "not_configured"
    assert destination.posts == 0


def test_legacy_sheet_columns_are_supported_without_changing_headers(sync_env):
    factory, destination, key, _ = sync_env
    study_labels = {"Mã nghiên cứu", "Giai đoạn nghiên cứu", "Bệnh viện trung tâm ung thư (1/0)"}
    destination.headers = [label for label in destination.headers if label not in study_labels]
    worker.process_one()
    with factory() as db:
        assert db.get(Submission,key).sync_status == "synced"
    assert len(destination.rows) == 1 and len(destination.rows[0]) == len(destination.headers)


def test_sheet_display_normalization_preserves_identifier_meaning():
    assert sheets.same_sheet_row(["Số HS", "PARA", "CA 125"], ["'000123", "'0000", "35.20"], ["000123", "0000", "35,2"])
    assert not sheets.same_sheet_row(["Số HS"], ["'000123"], ["123"])
    assert not sheets.same_sheet_row(["CA 125"], ["35.2"], ["35.3"])


def test_published_configuration_realigns_old_rows_and_accepts_new_fields(sync_env):
    from app.schemas.form import ClinicalFieldSchema
    from app.services.form_configuration import effective_schema
    factory, destination, key, _ = sync_env
    assert worker.process_one()
    with factory() as db:
        old = db.get(Submission, key)
        schema = effective_schema(old.form_version.schema_json)
        schema.version = 2
        next(f for f in schema.clinical_fields if f.id == "so_hs").label = "Số hồ sơ mới"
        schema.clinical_fields.append(ClinicalFieldSchema(id="custom_score",label="Điểm mới",type="number"))
        form = FormVersion(form_key="ovarian-pathology-who",version=2,status="published",schema_json=schema.model_dump(mode="json"),schema_hash="synthetic-version-2")
        db.add(form);db.flush()
        db.add(Submission(submission_uuid=uuid.uuid4(),form_version_id=form.id,payload_hash="synthetic-new",classification="unspecified",answers={"clinical_data":{"so_hs":"0007","custom_score":"1.00"}},workflow_status="submitted",sync_status="pending"))
        old.sync_status="pending"
        db.commit()
    assert worker.process_one()
    assert worker.process_one()
    assert len(destination.rows) == 2
    assert "Số hồ sơ mới" in destination.headers and "Số HS" not in destination.headers
    index = destination.headers.index("Điểm mới")
    assert {row[index] for row in destination.rows} == {"", "1.00"}
    with factory() as db:
        assert all(sub.sync_status == "synced" for sub in db.query(Submission).all())


def test_renamed_identifier_still_preserves_leading_zeros():
    assert sheets.same_sheet_row(["Số hồ sơ mới"],["'0007"],["0007"],set(),{"Số hồ sơ mới"})
    assert not sheets.same_sheet_row(["Số hồ sơ mới"],["'0007"],["7"],set(),{"Số hồ sơ mới"})
