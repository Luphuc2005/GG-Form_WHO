"""Unit configuration upgrades preserve shared edits, custom questions and history."""
from copy import deepcopy
import uuid

import pytest
from sqlalchemy import func, select

from app.commands.enable_biomarker_units import publish_biomarker_units
from app.models.form_management import FormDraft, FormSheetJob
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.repositories.form_repo import FormRepository
from app.services.biomarker_units import BIOMARKER_UNIT_FIELDS
from app.services.form_configuration import FORM_KEY, effective_schema


def managed(db):
    current = FormRepository.get_published_by_key(db, FORM_KEY)
    raw = effective_schema(current.schema_json).model_dump(mode="json")
    raw["clinical_fields"] = [field for field in raw["clinical_fields"] if field["id"] not in BIOMARKER_UNIT_FIELDS]
    raw["clinical_fields"].append({"id": "custom_surgical_side", "label": "Số lượng u", "type": "select",
        "section": "sec6", "choices": ["Trái", "Phải", "2 bên"], "active": True, "export": True})
    current.schema_json = raw
    db.commit()
    return current


def test_preview_and_publish_preserve_custom_questions_values_and_who(db_session):
    current = managed(db_session)
    original = deepcopy(current.schema_json)
    values = {"afp": "12.500", "custom_surgical_side": "Phải"}
    record = Submission(submission_uuid=uuid.uuid4(), form_version_id=current.id, answers={"clinical_data": values},
        payload_hash="synthetic", classification="unspecified", workflow_status="submitted", sync_status="synced")
    db_session.add(record); db_session.commit()
    preview = publish_biomarker_units(db_session)
    assert preview["status"] == "preview" and set(preview["new_field_ids"]) == set(BIOMARKER_UNIT_FIELDS)
    assert db_session.scalar(select(func.count(FormVersion.id))) == 1
    report = publish_biomarker_units(db_session, apply=True)
    assert report["status"] == "published" and report["preserved_custom_questions"] == 1
    latest = FormRepository.get_published_by_key(db_session, FORM_KEY)
    assert latest.schema_json["fields"] == original["fields"]
    assert [field for field in latest.schema_json["clinical_fields"] if field["id"] not in BIOMARKER_UNIT_FIELDS] == original["clinical_fields"]
    db_session.refresh(current); db_session.refresh(record)
    assert current.schema_json == original and record.form_version_id == current.id
    assert record.answers["clinical_data"] == values and record.sync_status == "pending"
    job = db_session.get(FormSheetJob, FORM_KEY)
    assert job.target_version == latest.version and job.status == "pending"
    again = publish_biomarker_units(db_session, apply=True)
    assert again["status"] == "already_enabled"
    assert db_session.scalar(select(func.count(FormVersion.id))) == 2


def test_shared_configuration_draft_is_not_deleted_or_overwritten(db_session):
    current = managed(db_session)
    raw = deepcopy(current.schema_json); raw["title"] = "SYNTHETIC EDIT STILL IN PROGRESS"
    db_session.add(FormDraft(form_key=FORM_KEY, base_version=current.version, revision=3, schema_json=raw, updated_by="synthetic"))
    db_session.commit()
    assert publish_biomarker_units(db_session)["pending_configuration_draft"]
    with pytest.raises(RuntimeError, match="bản nháp"):
        publish_biomarker_units(db_session, apply=True)
    draft = db_session.get(FormDraft, FORM_KEY)
    assert draft.revision == 3 and draft.schema_json == raw
    assert db_session.scalar(select(func.count(FormVersion.id))) == 1


def test_old_managed_record_can_confirm_its_original_unit_without_rewriting_its_form(auth_client, db_session):
    current = managed(db_session)
    original = deepcopy(current.schema_json)
    response = auth_client.post("/api/v1/records", json={"submission_uuid": str(uuid.uuid4()), "form_version": current.version})
    record = response.json()
    answers = {"pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]},
               "clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": "SYNTHETIC-LEGACY-UNIT", "afp": "12.500"}}
    path = f"/api/v1/records/{record['submission_uuid']}"
    saved = auth_client.put(path, json={"revision": record["revision"], "answers": answers})
    assert saved.status_code == 200
    publish_biomarker_units(db_session, apply=True)
    answers["clinical_data"]["afp_unit"] = "ng/mL"
    confirmed = auth_client.put(path, json={"revision": saved.json()["revision"], "answers": answers})
    assert confirmed.status_code == 200, confirmed.text
    assert confirmed.json()["answers"]["clinical_data"]["afp"] == "12.500"
    assert confirmed.json()["form_version"] == current.version
    db_session.refresh(current)
    assert current.schema_json == original


def test_version_allocation_includes_archived_versions(db_session):
    current = managed(db_session)
    archived = deepcopy(current.schema_json); archived["version"] = 7
    db_session.add(FormVersion(form_key=FORM_KEY, version=7, status="archived", schema_json=archived, schema_hash="synthetic"))
    db_session.commit()
    assert publish_biomarker_units(db_session, apply=True)["published_version"] == 8


@pytest.mark.parametrize("mutation", ["hide_unit", "hide_other", "drop_export", "always_required", "remove_other_choice", "move_unit"])
def test_authoring_cannot_detach_units_from_their_result(auth_client, db_session, mutation):
    publish_biomarker_units(db_session, apply=True)
    payload = auth_client.get("/api/v1/admin/form-builder").json()
    change = {"base_version": payload["base_version"], "draft_revision": 0, "schema": payload["schema"]}
    fields = {field["id"]: field for field in change["schema"]["clinical_fields"]}
    if mutation == "hide_unit": fields["afp_unit"]["active"] = False
    if mutation == "hide_other": fields["afp_unit_other"]["active"] = False
    if mutation == "drop_export": fields["afp_unit"]["export"] = False
    if mutation == "always_required": fields["afp_unit"]["required"] = True
    if mutation == "remove_other_choice": fields["afp_unit"]["choices"].remove("Khác")
    if mutation == "move_unit": fields["afp_unit"]["section"] = "extra"
    result = auth_client.post("/api/v1/admin/form-builder/publish", json=change)
    assert result.status_code == 422, result.text
    assert auth_client.get("/api/v1/forms/current").json()["version"] == payload["base_version"]


def test_admin_can_add_a_unit_without_changing_pinned_catalogs(auth_client, db_session):
    publish_biomarker_units(db_session, apply=True)
    original = auth_client.get("/api/v1/forms/current").json()
    payload = auth_client.get("/api/v1/admin/form-builder").json()
    fields = payload["schema"]["clinical_fields"]
    next(field for field in fields if field["id"] == "he4_unit")["choices"].append("Đơn vị phòng xét nghiệm mới")
    change = {"base_version": payload["base_version"], "draft_revision": 0, "schema": payload["schema"]}
    published = auth_client.post("/api/v1/admin/form-builder/publish", json=change)
    assert published.status_code == 200, published.text
    old = auth_client.get(f"/api/v1/forms/{original['version']}").json()
    assert old["schema_json"] == original["schema_json"]
    new = auth_client.get("/api/v1/forms/current").json()
    assert "Đơn vị phòng xét nghiệm mới" in next(field for field in new["schema_json"]["clinical_fields"] if field["id"] == "he4_unit")["choices"]
