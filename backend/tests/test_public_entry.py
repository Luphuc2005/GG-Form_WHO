import io
import uuid
import pytest
from openpyxl import load_workbook
from sqlalchemy import select, func
from app.core.security import create_access_token
from app.models.submission_event import SubmissionEvent
from app.models.submission import Submission


def begin(client, key=None, identifier=None):
    headers = {"X-Draft-Key": key or uuid.uuid4().hex+uuid.uuid4().hex}
    response = client.post("/api/v1/public/records", headers=headers, json={"submission_uuid":identifier or str(uuid.uuid4()), "form_version":1})
    assert response.status_code == 201, response.text
    return response.json(), headers


def answers(**extra):
    return {"pathology":{"selected":[{"id":"hgsc_8461_3"}]}, "classification":"benign",
        "clinical_data":{"hospital_code":"TD","study_phase":"R","so_hs":"000123","treatment_date":"2026-01-01","para":"0000", **extra}}


def save(client, row, headers, data=None):
    result = client.put(f"/api/v1/public/records/{row['submission_uuid']}", headers=headers, json={"revision":row["revision"], "answers":data or answers()})
    assert result.status_code == 200, result.text
    return result.json()


def send(client, row, headers):
    return client.post(f"/api/v1/public/records/{row['submission_uuid']}/submit",headers=headers,json={"revision":row["revision"]})


def test_anonymous_entry_does_not_open_other_patient_data(client):
    row, headers = begin(client)
    path = f"/api/v1/public/records/{row['submission_uuid']}"
    assert client.get(path).status_code == 422
    assert client.get(path,headers={"X-Draft-Key":"x"*64}).status_code == 404
    assert client.get(path,headers=headers).json()["answers"]["clinical_data"] == {}
    claim = client.post("/api/v1/public/records",headers={"X-Draft-Key":"x"*64},json={"submission_uuid":row["submission_uuid"],"form_version":1})
    assert claim.status_code == 404
    assert client.get("/api/v1/records").status_code == 401
    assert client.get("/api/v1/admin/submissions").status_code == 401
    assert client.get("/api/v1/admin/export.xlsx").status_code == 401
    assert client.get("/api/v1/public/records").status_code == 405
    assert "public_access_hash" not in row


def test_public_send_is_immediately_in_csv_and_real_excel_without_approval(client, db_session):
    row, headers = begin(client)
    row = save(client,row,headers,answers(ho_ten="=SYNTHETIC-LITERAL"))
    receipt = send(client,row,headers)
    assert receipt.status_code == 200
    assert receipt.json()["workflow_status"] == "submitted"
    assert "answers" not in receipt.json()
    sub = db_session.get(Submission,row["id"])
    assert sub.sync_status == "pending" and sub.approved_at is None
    doctor = {"Authorization":"Bearer "+create_access_token({"sub":"admin"})}
    exported_csv = client.get("/api/v1/admin/export.csv",headers=doctor).text
    assert receipt.json()["study_code"] in exported_csv
    assert row["submission_uuid"] not in exported_csv
    downloaded = client.get("/api/v1/admin/export.xlsx",headers=doctor)
    assert downloaded.status_code == 200
    assert "spreadsheetml.sheet" in downloaded.headers["content-type"]
    workbook = load_workbook(io.BytesIO(downloaded.content))
    sheet = workbook.active
    labels = [c.value for c in sheet[1]]
    values = dict(zip(labels,[c.value for c in sheet[2]]))
    assert values["Số HS"] == "000123" and values["PARA"] == "0000"
    assert values["Họ Tên"] == "=SYNTHETIC-LITERAL"
    assert sheet.cell(2,labels.index("Họ Tên")+1).data_type == "s"


def test_retries_do_not_duplicate_and_public_edits_close_after_send(client, db_session):
    row, headers = begin(client)
    duplicate, _ = begin(client,headers["X-Draft-Key"],row["submission_uuid"])
    assert duplicate["id"] == row["id"]
    row = save(client,row,headers)
    assert send(client,row,headers).status_code == 200
    assert send(client,row,headers).status_code == 200
    assert db_session.scalar(select(func.count(SubmissionEvent.id)).where(SubmissionEvent.submission_id==row["id"],SubmissionEvent.action=="submit")) == 1
    closed = client.get(f"/api/v1/public/records/{row['submission_uuid']}",headers=headers).json()
    assert "answers" not in closed
    assert client.put(f"/api/v1/public/records/{row['submission_uuid']}",headers=headers,json={"revision":row["revision"],"answers":answers(ho_ten="Another")}).status_code == 409


def test_doctor_can_correct_sent_form_without_reopening_or_approval(client, db_session):
    row, headers = begin(client)
    row = save(client,row,headers)
    send(client,row,headers)
    doctor = {"Authorization":"Bearer "+create_access_token({"sub":"admin"})}
    current = client.get(f"/api/v1/records/{row['submission_uuid']}",headers=doctor).json()
    corrected = client.put(f"/api/v1/records/{row['submission_uuid']}",headers=doctor,json={"revision":current["revision"],"answers":answers(ca_125="35.2")})
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["workflow_status"] == "submitted" and corrected.json()["sync_status"] == "pending"
    assert "35.2" in client.get("/api/v1/admin/export.csv",headers=doctor).text
    events = client.get(f"/api/v1/records/{row['submission_uuid']}/history",headers=doctor).json()
    event = next(e for e in events if e["action"] == "edit")
    assert event["actor"] == "admin" and event["after_answers"]["clinical_data"]["ca_125"] == "35.2"
    assert event["before_answers"] != event["after_answers"]


def test_anonymous_drafts_keep_duplicate_episode_protection(client):
    first, headers = begin(client)
    save(client,first,headers)
    second, other_headers = begin(client)
    duplicate = client.put(f"/api/v1/public/records/{second['submission_uuid']}",headers=other_headers,json={"revision":1,"answers":answers()})
    assert duplicate.status_code == 409
    empty = client.get(f"/api/v1/public/records/{second['submission_uuid']}",headers=other_headers).json()
    assert empty["answers"]["clinical_data"] == {}


@pytest.mark.parametrize("percentages,expected", [
    ((10,20,15,15,20,20),200),
    ((12,32,12,32,32,12),422),
])
def test_public_form_checks_six_field_total_without_modifying_values(client, db_session, percentages, expected):
    from app.services.clinical_validation import IOTA
    row, headers = begin(client)
    fields = dict(zip(IOTA, percentages))
    row = save(client, row, headers, answers(**fields))
    response = send(client, row, headers)
    assert response.status_code == expected
    stored = db_session.get(Submission, row["id"])
    assert tuple(stored.answers["clinical_data"][key] for key in IOTA) == percentages


def test_ultrasound_conclusion_survives_submission_and_excel_export(client):
    conclusion = "Kết luận siêu âm thử nghiệm\nDòng thứ hai"
    row, headers = begin(client)
    row = save(client, row, headers, answers(sa_ket_luan=conclusion))
    assert send(client, row, headers).status_code == 200
    doctor = {"Authorization": "Bearer " + create_access_token({"sub": "admin"})}
    detail = client.get(f"/api/v1/records/{row['submission_uuid']}", headers=doctor).json()
    assert detail["answers"]["clinical_data"]["sa_ket_luan"] == conclusion
    assert "Kết luận siêu âm" in client.get("/api/v1/admin/export.csv", headers=doctor).text
    workbook = load_workbook(io.BytesIO(client.get("/api/v1/admin/export.xlsx", headers=doctor).content))
    sheet = workbook.active
    labels = [cell.value for cell in sheet[1]]
    assert sheet.cell(2, labels.index("Kết luận siêu âm") + 1).value == conclusion
