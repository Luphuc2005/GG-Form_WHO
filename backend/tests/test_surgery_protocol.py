"""Surgical findings survive entry, submission and both export formats."""
from copy import deepcopy
import csv
import io
import uuid

from openpyxl import load_workbook
import pytest

from app.services.clinical_validation import CONTRACT, SURGERY_DETAILS, SURGERY_FIELDS
from app.services.form_configuration import baseline_fields


def create_record(client, **clinical):
    response = client.post("/api/v1/records", json={"submission_uuid": str(uuid.uuid4()), "form_version": 1})
    assert response.status_code == 201, response.text
    answers = {
        "pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]},
        "clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": "SYNTHETIC-" + str(uuid.uuid4()), **clinical},
    }
    return response.json(), answers


def save(client, record, answers):
    return client.put(f"/api/v1/records/{record['submission_uuid']}", json={"revision": record["revision"], "answers": answers})


@pytest.mark.parametrize("side", ["Trái", "Phải", "2 bên"])
def test_surgical_findings_roundtrip_and_export_without_reusing_imaging_values(auth_client, side):
    values = {"pt_so_luong_u": side, "sa_so_luong_u": "Trái", "mri_so_luong_u": "Phải"}
    for index, (parent, detail) in enumerate(SURGERY_DETAILS.items()):
        values.update({parent: "Có", detail: f"Mô tả phẫu thuật giả lập {index}\nDòng thứ hai"})
    record, answers = create_record(auth_client, **values)
    response = save(auth_client, record, answers)
    assert response.status_code == 200, response.text
    saved = response.json()
    reread = auth_client.get(f"/api/v1/records/{record['submission_uuid']}")
    assert reread.status_code == 200
    assert all(reread.json()["answers"]["clinical_data"][key] == value for key, value in values.items())
    submitted = auth_client.post(f"/api/v1/records/{record['submission_uuid']}/transition", json={"revision": saved["revision"], "action": "submit"})
    assert submitted.status_code == 200, submitted.text

    rows = list(csv.reader(io.StringIO(auth_client.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    book = load_workbook(io.BytesIO(auth_client.get("/api/v1/admin/export.xlsx").content), read_only=True)
    excel_rows = list(book.active.values)
    for key, value in values.items():
        index = rows[0].index(CONTRACT["fields"][key])
        assert rows[1][index] == excel_rows[1][index] == value
    assert len(rows[0]) == len(set(rows[0]))
    book.close()


@pytest.mark.parametrize("key,value", [
    ("pt_so_luong_u", "1 bên"), ("pt_so_luong_u", "3"),
    *((parent, "Không có") for parent in SURGERY_DETAILS),
])
def test_surgical_switches_reject_unsupported_choices(auth_client, key, value):
    record, answers = create_record(auth_client, **{key: value})
    assert save(auth_client, record, answers).status_code == 422


@pytest.mark.parametrize("parent,detail", list(SURGERY_DETAILS.items()))
def test_descriptions_are_entered_only_for_positive_findings(auth_client, parent, detail):
    record, answers = create_record(auth_client, **{parent: "Không", detail: "Mô tả giả lập"})
    assert save(auth_client, record, answers).status_code == 422
    answers["clinical_data"][parent] = "Có"
    response = save(auth_client, record, answers)
    assert response.status_code == 200, response.text
    inconsistent = deepcopy(answers)
    inconsistent["clinical_data"][parent] = "Không"
    assert save(auth_client, response.json(), inconsistent).status_code == 422
    corrected = deepcopy(answers)
    corrected["clinical_data"].update({parent: "Không", detail: ""})
    response = save(auth_client, response.json(), corrected)
    assert response.status_code == 200, response.text
    assert response.json()["answers"]["clinical_data"][detail] == ""


def test_new_surgical_fields_are_optional_and_available_to_form_builder(auth_client):
    record, answers = create_record(auth_client)
    response = save(auth_client, record, answers)
    assert response.status_code == 200
    submitted = auth_client.post(f"/api/v1/records/{record['submission_uuid']}/transition", json={"revision": response.json()["revision"], "action": "submit"})
    assert submitted.status_code == 200, submitted.text
    fields = {field.id: field for field in baseline_fields()}
    for key in SURGERY_FIELDS:
        assert fields[key].section == "sec6" and fields[key].active and fields[key].export
        assert not fields[key].required
    for parent, detail in SURGERY_DETAILS.items():
        assert fields[detail].type == "textarea"
        assert fields[detail].show_when == parent and fields[detail].show_values == ["Có"]
    assert not fields["pt_dich_o_bung"].active
    assert fields["pt_so_luong_u"].choices == fields["sa_so_luong_u"].choices == fields["mri_so_luong_u"].choices
