"""The deploy-only patch publishes WHO updates without rewriting older records."""
from copy import deepcopy
import hashlib
import json
from pathlib import Path
from runpy import run_path
import uuid

import pytest
from sqlalchemy import func, select

from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.repositories.form_repo import FormRepository
from app.services.export_svc import ExportService

ROOT = Path(__file__).resolve().parents[2]
upgrade_catalog = run_path(str(ROOT / "deploy" / "fix_who_catalog.py"))["upgrade_catalog"]


@pytest.fixture
def source():
    return json.loads((ROOT / "form-definitions" / "ovarian-pathology-v1.json").read_text(encoding="utf-8"))


def legacy_form(db, source):
    current = FormRepository.get_published_by_key(db, source["form_key"])
    raw = deepcopy(source)
    field = next(field for field in raw["fields"] if field["id"] == "pathology")
    field["options"] = field["options"][:15]
    field["options"][0]["label"] = "Tên WHO cũ đã lưu"
    current.schema_json = raw
    # Simulate an old database with a misleading schema_hash value.
    current.schema_hash = hashlib.sha256(json.dumps(source).encode()).hexdigest()
    db.commit()
    return current


def test_preview_reports_actual_catalog_and_does_not_publish(db_session, source):
    original = legacy_form(db_session, source)
    before = deepcopy(original.schema_json)
    result = upgrade_catalog(db_session, source)
    assert result == {"status": "preview", "current_version": 1, "current_options": 15, "target_options": 20}
    assert db_session.scalar(select(func.count(FormVersion.id))) == 1
    assert db_session.get(FormVersion, original.id).schema_json == before


def test_publish_preserves_existing_records_and_is_repeatable(db_session, source):
    original = legacy_form(db_session, source)
    before = deepcopy(original.schema_json)
    record = Submission(
        submission_uuid=uuid.uuid4(), form_version_id=original.id, payload_hash="synthetic",
        classification="benign", workflow_status="submitted",
        answers={"pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]}, "clinical_data": {}},
    )
    db_session.add(record)
    db_session.commit()
    result = upgrade_catalog(db_session, source, apply=True)
    assert result["status"] == "published" and result["published_version"] == 2
    current = FormRepository.get_published_by_key(db_session, source["form_key"])
    options = next(field["options"] for field in current.schema_json["fields"] if field["id"] == "pathology")
    target = next(field["options"] for field in source["fields"] if field["id"] == "pathology")
    assert [(option["id"], option["label"]) for option in options] == [(option["id"], option["label"]) for option in target]
    assert current.schema_json["version"] == 2
    assert db_session.get(FormVersion, original.id).schema_json == before
    db_session.refresh(record)
    assert record.form_version_id == original.id
    assert "Tên WHO cũ đã lưu" in "".join(ExportService.stream_csv(db_session))
    again = upgrade_catalog(db_session, source, apply=True)
    assert again["status"] == "already_current" and again["current_options"] == 20
    assert db_session.scalar(select(func.count(FormVersion.id))) == 2


def test_matching_catalog_ignores_stale_hash_and_does_not_publish(db_session, source):
    current = FormRepository.get_published_by_key(db_session, source["form_key"])
    current.schema_hash = "stale-metadata"
    db_session.commit()
    result = upgrade_catalog(db_session, source, apply=True)
    assert result["status"] == "already_current"
    assert db_session.scalar(select(func.count(FormVersion.id))) == 1


def test_patch_preserves_managed_clinical_fields_and_allocates_after_archived_versions(db_session, source):
    current = legacy_form(db_session, source)
    raw = deepcopy(current.schema_json)
    raw["clinical_fields"] = [{
        "id": "custom_note", "label": "Ghi chú riêng", "type": "textarea", "section": "extra",
        "active": True, "export": True,
    }]
    current.schema_json = raw
    db_session.add(FormVersion(
        form_key=source["form_key"], version=4, status="archived",
        schema_json={**deepcopy(source), "version": 4}, schema_hash="synthetic",
    ))
    db_session.commit()
    result = upgrade_catalog(db_session, source, apply=True)
    assert result["published_version"] == 5
    new = FormRepository.get_published_by_key(db_session, source["form_key"])
    assert new.schema_json["clinical_fields"] == raw["clinical_fields"]
    assert new.schema_json["title"] == raw["title"]


def test_patch_rejects_a_source_without_twenty_options(db_session, source):
    broken = deepcopy(source)
    next(field for field in broken["fields"] if field["id"] == "pathology")["options"].pop()
    with pytest.raises(RuntimeError, match="20 lựa chọn"):
        upgrade_catalog(db_session, broken, apply=True)
    assert db_session.scalar(select(func.count(FormVersion.id))) == 1


def test_new_public_form_uses_twenty_options_and_can_submit_both_who_results(client, db_session, source):
    legacy_form(db_session, source)
    upgrade_catalog(db_session, source, apply=True)
    current = client.get("/api/v1/forms/current").json()
    options = next(field["options"] for field in current["schema_json"]["fields"] if field["id"] == "pathology")
    assert current["version"] == 2 and len(options) == 20
    headers = {"X-Draft-Key": uuid.uuid4().hex * 2}
    record = client.post("/api/v1/public/records", headers=headers, json={
        "submission_uuid": str(uuid.uuid4()), "form_version": current["version"],
    }).json()
    path = f"/api/v1/public/records/{record['submission_uuid']}"
    saved = client.put(path, headers=headers, json={
        "revision": record["revision"],
        "answers": {
            "pathology": {"selected": [
                {"id": "pathology_other", "slot": 1, "other_text": "Kết quả khác thử nghiệm"},
                {"id": "brenner_tumor_9000_0", "slot": 2},
            ]},
            "clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": uuid.uuid4().hex},
        },
    })
    assert saved.status_code == 200, saved.text
    sent = client.post(path + "/submit", headers=headers, json={"revision": saved.json()["revision"]})
    assert sent.status_code == 200, sent.text
