"""Revision and retry contracts for bounded modern Sheet batches."""
import json
import uuid
import pytest
from datetime import datetime, timezone, timedelta
from sqlalchemy import select
from app.models.submission import Submission
from app.services import batch_sync as worker
from app.services import google_sheets_svc as sheets
from tests.test_record_sync import sync_env, Response


class BatchSheet:
    def __init__(self, original):
        self.original = original
        self.batches = []
        self.calls = []
        self.fences = {}
        self.ignore = False
        self.lose_response = False
        self.corrupt_first = False
        self.on_write = None

    def open(self, request, timeout):
        body = json.loads(request.data)
        action = body.get("action")
        self.calls.append(action)
        if action == "capabilities":
            return Response(json.dumps({"status":"capabilities", "batch_version":1,
                "layout_version":0,"layout_applied":True,"headers":self.original.headers,"schema_version":1}).encode())
        if action == "snapshot":
            raise AssertionError("Batch sync must not read the entire clinical table")
        if action != "batch":
            return self.original.open(request, timeout)
        self.batches.append(body)
        assert len(request.data) < worker.MAX_BATCH_BYTES+20000
        assert body["headers"] == self.original.headers
        results = []
        for item in body["items"]:
            key = item["submission_uuid"]
            previous = self.fences.get(key)
            if previous and (previous[0] > item["revision"] or previous[1] > body["schema_version"]):
                results.append({"submission_uuid":key,"revision":item["revision"],"status":"stale"})
                continue
            self.fences[key] = (item["revision"], body["schema_version"], item["digest"])
            deleting = item["row"] is None
            if not self.ignore:
                self.original.rows = [row for row in self.original.rows if row[0] != key]
                if not deleting:
                    self.original.rows.append([str(cell).removeprefix("'") if cell is not None else "" for cell in item["row"]])
            matching = [row for row in self.original.rows if row[0] == key]
            results.append({"submission_uuid":key,"revision":item["revision"],"status":"removed" if deleting else "synced",
                            "count":len(matching),"row":matching[0] if matching and not deleting else None})
        if self.on_write:
            callback, self.on_write = self.on_write, None
            callback()
        if self.lose_response:
            self.lose_response = False
            raise TimeoutError("Synthetic lost response after application")
        if self.corrupt_first:
            results[0]["count"] = 2
        return Response(json.dumps({"status":"batch_synced","results":results}).encode())


def modern(sync_env, monkeypatch, count=1):
    factory, destination, key, config = sync_env
    config.SHEETS_SYNC_BATCH_SIZE = 100
    with factory() as db:
        original = db.get(Submission, key)
        for _ in range(count-1):
            db.add(Submission(submission_uuid=uuid.uuid4(),form_version_id=original.form_version_id,
                payload_hash="synthetic",classification="benign",answers=original.answers,
                workflow_status="submitted",revision=3,sync_status="pending"))
        db.commit()
    remote = BatchSheet(destination)
    monkeypatch.setattr(sheets.urllib.request,"urlopen",remote.open)
    return factory, destination, key, config, remote


def inflight(sync_env, monkeypatch, mode):
    """Run the real queue path and inject an API call after destination writes."""
    from types import SimpleNamespace
    from app.services import record_sync
    if mode == "batch":
        factory, destination, key, config, remote = modern(sync_env, monkeypatch)
        return factory, destination, key, remote, lambda: worker.process_batch(factory, config)
    factory, destination, key, _ = sync_env
    remote = SimpleNamespace(on_write=None)

    def open(request, timeout):
        response = destination.open(request, timeout)
        if "row" in json.loads(request.data) and remote.on_write:
            callback, remote.on_write = remote.on_write, None
            callback()
        return response

    monkeypatch.setattr(sheets.urllib.request, "urlopen", open)
    return factory, destination, key, remote, record_sync.process_one


def test_large_queue_uses_bounded_batches_and_never_reads_full_table(sync_env, monkeypatch):
    factory, destination, _, config, remote = modern(sync_env, monkeypatch, 205)
    assert worker.process_batch(factory, config)
    assert worker.process_batch(factory, config)
    assert worker.process_batch(factory, config)
    assert not worker.process_batch(factory, config)
    assert [len(batch["items"]) for batch in remote.batches] == [100,100,5]
    assert len(destination.rows) == 205 and len({row[0] for row in destination.rows}) == 205
    assert "snapshot" not in remote.calls
    with factory() as db:
        assert all(sub.sync_status == "synced" and sub.synced_revision == sub.revision for sub in db.scalars(select(Submission)))


def test_lost_response_is_replayed_without_duplicate_records(sync_env, monkeypatch):
    factory, destination, key, config, remote = modern(sync_env, monkeypatch)
    remote.lose_response = True
    assert worker.process_batch(factory, config)
    assert len(destination.rows) == 1
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "failed"
        sub.sync_attempted_at = datetime.now(timezone.utc)-timedelta(minutes=2)
        db.commit()
    assert worker.process_batch(factory, config)
    assert len(destination.rows) == 1
    with factory() as db:
        assert db.get(Submission, key).sync_status == "synced"


def test_new_revision_during_batch_is_queued_for_next_pass(sync_env, monkeypatch):
    factory, destination, key, config, remote = modern(sync_env, monkeypatch)
    def edit():
        with factory() as db:
            record = db.get(Submission,key)
            record.revision += 1
            record.answers = {"clinical_data":{"so_hs":"SYNTHETIC-NEW"}}
            db.commit()
    remote.on_write = edit
    assert worker.process_batch(factory, config)
    with factory() as db:
        assert db.get(Submission,key).sync_status == "pending"
    assert worker.process_batch(factory, config)
    assert len(destination.rows) == 1 and "SYNTHETIC-NEW" in destination.rows[0]


@pytest.mark.parametrize("mode", ["batch", "legacy"])
def test_form_publication_during_sync_requeues_the_inflight_record(sync_env, monkeypatch, mode):
    from pathlib import Path
    from types import SimpleNamespace
    from app.api.v1.form_builder import ConfigurationChange, publish_configuration
    from app.schemas.form import ClinicalFieldSchema, FormSchemaDefinition
    from app.services.form_configuration import effective_schema

    factory, destination, key, remote, process = inflight(sync_env, monkeypatch, mode)
    with factory() as db:
        sub = db.get(Submission, key)
        sub.answers = {"clinical_data": {"so_hs": "SYNTHETIC", "custom_score": "7"}}
        schema = effective_schema(sub.form_version.schema_json)
        template = Path(__file__).resolve().parents[2] / "form-definitions/ovarian-pathology-v1.json"
        schema.fields = FormSchemaDefinition.model_validate_json(template.read_text(encoding="utf-8")).fields
        schema.clinical_fields.append(ClinicalFieldSchema(id="custom_score", label="Điểm thử", type="number", export=False))
        sub.form_version.schema_json = schema.model_dump(mode="json")
        db.commit()

    def publish():
        with factory() as db:
            schema = effective_schema(db.get(Submission, key).form_version.schema_json)
            next(field for field in schema.clinical_fields if field.id == "custom_score").export = True
            publish_configuration(ConfigurationChange(base_version=1, schema=schema), db, SimpleNamespace(username="synthetic"))

    remote.on_write = publish
    assert process()
    with factory() as db:
        assert db.get(Submission, key).sync_status == "pending"
    assert process()
    assert len(destination.rows) == 1
    assert destination.rows[0][destination.headers.index("Điểm thử")] == "7"
    with factory() as db:
        assert db.get(Submission, key).sync_status == "synced"


@pytest.mark.parametrize("mode", ["batch", "legacy"])
def test_explicit_retry_during_sync_is_not_lost_on_completion(sync_env, monkeypatch, mode):
    from app.api.v1.form_builder import retry_sheet
    factory, destination, key, remote, process = inflight(sync_env, monkeypatch, mode)
    with factory() as db:
        db.get(Submission, key).synced_revision = 2
        db.commit()

    def retry():
        with factory() as db:
            assert retry_sheet(db, None)["queued_records"] == 1
            assert db.get(Submission, key).sync_status == "syncing"

    remote.on_write = retry
    assert process()
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "pending" and sub.synced_revision == 2
    assert process()
    assert len(destination.rows) == 1
    with factory() as db:
        sub = db.get(Submission, key)
        assert sub.sync_status == "synced" and sub.synced_revision == sub.revision


def test_removal_bypasses_schema_failure_and_is_prioritized(sync_env, monkeypatch):
    factory, destination, key, config, remote = modern(sync_env, monkeypatch, 2)
    assert worker.process_batch(factory, config)
    with factory() as db:
        records = db.scalars(select(Submission).order_by(Submission.id)).all()
        records[0].sync_status = "pending"
        records[1].workflow_status, records[1].sync_status, records[1].revision = "trashed", "pending", 4
        removed_key = str(records[1].submission_uuid)
        db.commit()
    def fail(*args, **kwargs):
        raise AssertionError("A deletion must not depend on form schema")
    monkeypatch.setattr("app.services.form_sheet_sync.ensure_schema", fail)
    assert worker.process_batch(factory, config)
    assert remote.batches[-1]["items"][0]["submission_uuid"] == removed_key
    assert remote.batches[-1]["items"][0]["row"] is None
    assert len(destination.rows) == 1


def test_unverified_batch_item_does_not_mark_that_record_synced(sync_env, monkeypatch):
    factory, _, _, config, remote = modern(sync_env, monkeypatch, 2)
    remote.corrupt_first = True
    assert worker.process_batch(factory, config)
    with factory() as db:
        assert sorted(sub.sync_status for sub in db.scalars(select(Submission))) == ["failed","synced"]


def test_batch_payload_is_split_by_bytes_as_well_as_record_count(sync_env, monkeypatch):
    factory, destination, _, config, remote = modern(sync_env, monkeypatch, 40)
    with factory() as db:
        for sub in db.scalars(select(Submission)):
            sub.answers = {"clinical_data":{"ho_ten":"SYNTHETIC-"+"X"*50000}}
        db.commit()
    assert worker.process_batch(factory, config)
    assert len(remote.batches) == 2 and len(destination.rows) == 40


def test_empty_sheet_is_initialized_before_its_first_batch(sync_env, monkeypatch):
    factory, destination, _, config, remote = modern(sync_env, monkeypatch)
    destination.headers = []
    assert worker.process_batch(factory, config)
    assert len(destination.headers) > 1 and len(destination.rows) == 1
    assert "schema" in remote.calls and "snapshot" not in remote.calls
    with factory() as db:
        assert db.scalar(select(Submission)).sync_status == "synced"
