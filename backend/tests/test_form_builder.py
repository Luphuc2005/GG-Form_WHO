"""Admin authoring to versioned entry, Excel/CSV and durable schema jobs.

All clinical values are synthetic and no network calls are made.
"""
import csv
import io
import uuid
from copy import deepcopy
from openpyxl import load_workbook
import pytest
from app.core.security import create_access_token, hash_password
from app.models.admin_user import AdminUser
from app.models.form_management import FormDraft, FormSheetJob
from app.models.submission import Submission


BASE = "/api/v1/admin/form-builder"


def config(client):
    state = client.get(BASE).json()
    return {"base_version": state["base_version"], "draft_revision": 0, "schema": state["schema"]}


def custom(**overrides):
    return {"id":"custom_followup", "label":"Ngày tái khám thử nghiệm", "type":"date", "section":"extra", "active":True, "required":False, "export":True, "choices":[], "help_text":"Theo hồ sơ thử nghiệm", **overrides}


def publish(client, payload):
    response = client.post(BASE+"/publish", json=payload)
    assert response.status_code == 200, response.text
    return response.json()


def draft_record(client, version, extra=None):
    key = {"X-Draft-Key":uuid.uuid4().hex*2}
    record = client.post("/api/v1/public/records", headers=key, json={"submission_uuid":str(uuid.uuid4()), "form_version":version}).json()
    answers = {"clinical_data":{"hospital_code":"TD", "study_phase":"R", "so_hs":uuid.uuid4().hex, **(extra or {})}, "pathology":{"selected":[{"id":"serous_cystadenoma_8441_0"}]}}
    return record, key, answers


def save_record(client, record, key, answers):
    return client.put(f"/api/v1/public/records/{record['submission_uuid']}", headers=key, json={"revision":record["revision"], "answers":answers})


def submit(client, record, key):
    return client.post(f"/api/v1/public/records/{record['submission_uuid']}/submit", headers=key, json={"revision":record["revision"]})


def test_draft_persists_without_changing_public_form_and_prevents_lost_updates(auth_client, db_session):
    c = auth_client
    payload = config(c)
    payload["schema"]["clinical_fields"].append(custom())
    saved = c.put(BASE+"/draft", json=payload)
    assert saved.status_code == 200, saved.text
    assert saved.json()["draft_revision"] == 1
    assert c.get("/api/v1/forms/current").json()["version"] == 1
    state = c.get(BASE).json()
    assert state["draft"]["schema"]["clinical_fields"][-1]["id"] == "custom_followup"
    assert c.put(BASE+"/draft", json=payload).status_code == 409
    payload["draft_revision"] = 1
    assert c.put(BASE+"/draft", json=payload).json()["draft_revision"] == 2
    assert c.post(BASE+"/publish", json=payload).status_code == 409
    payload["draft_revision"] = 2
    assert publish(c,payload)["version"] == 2
    assert db_session.get(FormDraft, "ovarian-pathology-who") is None
    assert db_session.get(FormSheetJob,"ovarian-pathology-who").status == "pending"


@pytest.mark.parametrize("role", ["doctor","intern"])
def test_only_account_admin_can_change_form_configuration(client, db_session, role):
    db_session.add(AdminUser(username="synthetic_role",password_hash=hash_password("SyntheticPassword123!"),role=role,is_active=True));db_session.commit()
    headers={"Authorization":"Bearer "+create_access_token({"sub":"synthetic_role"})}
    assert client.get(BASE,headers=headers).status_code == 403
    assert client.post(BASE+"/retry-sheet",headers=headers).status_code == 403


@pytest.mark.parametrize("mutation", ["duplicate_id","duplicate_label","delete_existing","system_id","changed_type","invalid_choice","disable_identity"])
def test_invalid_schema_cannot_be_published(auth_client, mutation):
    payload = config(auth_client)
    fields = payload["schema"]["clinical_fields"]
    if mutation == "duplicate_id": fields.append(deepcopy(fields[0]))
    if mutation == "duplicate_label": fields.append(custom(label=fields[0]["label"]))
    if mutation == "delete_existing": fields.pop(0)
    if mutation == "system_id": fields.append(custom(id="study_code"))
    if mutation == "changed_type": fields[0]["type"]="date"
    if mutation == "invalid_choice": fields.append(custom(type="select",choices=["A","A"]))
    if mutation == "disable_identity": fields[0]["active"]=False
    assert auth_client.post(BASE+"/publish",json=payload).status_code == 422
    assert auth_client.get("/api/v1/forms/current").json()["version"] == 1


def test_old_and_new_records_keep_pinned_validation_and_share_export_columns(auth_client, db_session):
    c=auth_client
    old,key,answers=draft_record(c,1)
    old=save_record(c,old,key,answers).json()
    assert submit(c,old,key).status_code == 200
    payload=config(c)
    payload["schema"]["clinical_fields"].append(custom(required=True))
    name=next(f for f in payload["schema"]["clinical_fields"] if f["id"]=="ho_ten")
    name["label"]="Họ tên theo hồ sơ"
    publish(c,payload)
    assert c.get("/api/v1/forms/1").json()["schema_json"].get("clinical_fields") is None
    record,new_key,new_answers=draft_record(c,2,{"ho_ten":"SYNTHETIC"})
    saved=save_record(c,record,new_key,new_answers)
    assert saved.status_code == 200, saved.text
    record=saved.json()
    assert submit(c,record,new_key).status_code == 422
    new_answers["clinical_data"]["custom_followup"]="2027-01-20"
    record=save_record(c,record,new_key,new_answers).json()
    assert submit(c,record,new_key).status_code == 200
    output=c.get("/api/v1/admin/export.xlsx")
    workbook=load_workbook(io.BytesIO(output.content))
    rows=list(workbook.active.values);labels=rows[0]
    assert "Họ tên theo hồ sơ" in labels and "Họ Tên" not in labels
    index=labels.index("Ngày tái khám thử nghiệm")
    assert {r[index] for r in rows[1:]} == {None,"2027-01-20"}
    csv_rows=list(csv.reader(io.StringIO(c.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    assert list(labels) == csv_rows[0]
    assert db_session.get(Submission,old["id"]).form_version.version == 1
    workbook.close()


def test_custom_types_choices_and_retired_fields_are_validated_on_server(auth_client):
    c=auth_client;payload=config(c)
    payload["schema"]["clinical_fields"] += [custom(),custom(id="custom_score",label="Điểm thử nghiệm",type="number",min_value=0,max_value=5),custom(id="custom_choice",label="Lựa chọn thử nghiệm",type="multiselect",choices=["A","B"])]
    publish(c,payload)
    record,key,answers=draft_record(c,2,{"custom_followup":"bad-date","custom_score":"99","custom_choice":["C"]})
    assert save_record(c,record,key,answers).status_code == 422
    answers["clinical_data"].update(custom_followup="2026-01-01",custom_score="0",custom_choice=["A"])
    saved=save_record(c,record,key,answers)
    assert saved.status_code == 200, saved.text
    payload=config(c)
    next(f for f in payload["schema"]["clinical_fields"] if f["id"]=="custom_score")["active"]=False
    publish(c,payload)
    new,new_key,new_answers=draft_record(c,3,{"custom_score":"2"})
    assert save_record(c,new,new_key,new_answers).status_code == 422
    # The prior draft remains editable under its original version.
    assert save_record(c,saved.json(),key,answers).status_code == 200


def test_preview_has_no_publication_side_effects_and_stale_publish_fails(auth_client):
    c=auth_client;payload=config(c);payload["schema"]["clinical_fields"].append(custom())
    preview=c.post(BASE+"/preview",json=payload)
    assert preview.status_code == 200,preview.text
    assert any(col["key"]=="custom_followup" for col in preview.json()["columns"])
    assert c.get("/api/v1/forms/current").json()["version"] == 1
    publish(c,payload)
    assert c.post(BASE+"/publish",json=payload).status_code == 409


def test_renamed_header_cannot_be_reused_by_another_field(auth_client):
    c=auth_client;payload=config(c)
    next(f for f in payload["schema"]["clinical_fields"] if f["id"]=="ho_ten")["label"]="Tên mới thử nghiệm"
    publish(c,payload)
    payload=config(c);payload["schema"]["clinical_fields"].append(custom(label="Họ Tên"))
    assert c.post(BASE+"/publish",json=payload).status_code == 422


def test_mri_combined_value_remains_derived_and_export_toggle_keeps_database_data(auth_client):
    c=auth_client;payload=config(c)
    payload["schema"]["clinical_fields"].append(custom())
    publish(c,payload)
    record,key,answers=draft_record(c,2,{"mri_dich_nang_t1w":"thấp","mri_dich_nang_t2w":"cao","mri_dich_nang":"T1w: thấp, T2w: cao","custom_followup":"2027-01-20"})
    saved=save_record(c,record,key,answers)
    assert saved.status_code == 200,saved.text
    assert submit(c,saved.json(),key).status_code == 200
    payload=config(c)
    next(f for f in payload["schema"]["clinical_fields"] if f["id"]=="custom_followup")["export"]=False
    publish(c,payload)
    rows=list(csv.reader(io.StringIO(c.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    assert "Ngày tái khám thử nghiệm" not in rows[0]
    stored=c.get(f"/api/v1/records/{record['submission_uuid']}").json()
    assert stored["answers"]["clinical_data"]["custom_followup"] == "2027-01-20"
