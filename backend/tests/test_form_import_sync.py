"""Deployment imports preserve pinned data and enqueue managed schema changes."""
from copy import deepcopy
import json
from pathlib import Path
import uuid

from sqlalchemy import create_engine, select
from sqlalchemy.orm import sessionmaker

from app.commands import import_form
from app.database import Base
from app.models.form_management import FormSheetJob
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.services.form_configuration import FORM_KEY, effective_schema


def test_deploying_managed_configuration_queues_schema_and_records_and_is_repeatable(tmp_path, monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine)
    monkeypatch.setattr(import_form, "SessionLocal", factory)
    raw = json.loads((Path(__file__).resolve().parents[2] / "form-definitions" / "ovarian-pathology-v1.json").read_text(encoding="utf-8"))
    with factory() as db:
        form = FormVersion(form_key=FORM_KEY, version=1, status="published", schema_json=raw, schema_hash="synthetic")
        db.add(form)
        db.flush()
        for status in ("synced", "failed", "syncing"):
            db.add(Submission(submission_uuid=uuid.uuid4(), form_version_id=form.id, payload_hash="synthetic",
                              answers={"clinical_data": {"so_hs": "SYNTHETIC"}}, classification="unspecified",
                              workflow_status="submitted", revision=3, sync_status=status,
                              sync_attempts=5, sync_error="Synthetic prior failure"))
        db.add(FormSheetJob(form_key=FORM_KEY, target_version=2, status="failed", attempts=5, error="Synthetic prior failure"))
        db.commit()
    definition = effective_schema(raw).model_dump(mode="json")
    definition["version"] = 4
    file = tmp_path / "managed.json"
    file.write_text(json.dumps(definition, ensure_ascii=False), encoding="utf-8")
    import_form.import_form_schema(str(file))
    with factory() as db:
        job = db.get(FormSheetJob, FORM_KEY)
        assert job.target_version == 4 and job.status == "pending" and job.attempts == 0
        assert job.error is None and job.attempted_at is None
        records = list(db.scalars(select(Submission).order_by(Submission.id)))
        assert [record.sync_status for record in records] == ["pending", "pending", "syncing"]
        assert all(record.form_version.version == 1 and record.revision == 3 for record in records)
        assert all(record.answers["clinical_data"]["so_hs"] == "SYNTHETIC" for record in records)
        job.status = "synced"
        db.commit()
    import_form.import_form_schema(str(file))
    with factory() as db:
        assert db.get(FormSheetJob, FORM_KEY).status == "synced"
        assert len(list(db.scalars(select(FormVersion)))) == 2
    # Importing historical definitions must not roll the Sheet back from v4.
    historical = deepcopy(definition)
    historical["version"] = 2
    file.write_text(json.dumps(historical, ensure_ascii=False), encoding="utf-8")
    import_form.import_form_schema(str(file))
    with factory() as db:
        job = db.get(FormSheetJob, FORM_KEY)
        assert job.target_version == 4 and job.status == "synced"
    engine.dispose()
