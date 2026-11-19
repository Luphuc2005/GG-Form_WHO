"""Original lab values and units round-trip without hospital-based inference."""
from copy import deepcopy
import csv
from decimal import Decimal
import io
import uuid

from openpyxl import load_workbook
import pytest

from app.commands.enable_biomarker_units import publish_biomarker_units
from app.services.biomarker_units import BIOMARKER_UNIT_FIELDS
from app.services.clinical_validation import CONTRACT


@pytest.fixture
def units_form(db_session):
    return publish_biomarker_units(db_session, apply=True)["published_version"]


def draft(client, version, **values):
    result = client.post("/api/v1/records", json={"submission_uuid": str(uuid.uuid4()), "form_version": version})
    assert result.status_code == 201, result.text
    data = {"pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]},
            "clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": "SYNTHETIC-" + str(uuid.uuid4()), **values}}
    return result.json(), data


def save(client, record, data):
    return client.put(f"/api/v1/records/{record['submission_uuid']}", json={"revision": record["revision"], "answers": data})


def submit(client, record):
    return client.post(f"/api/v1/records/{record['submission_uuid']}/transition", json={"revision": record["revision"], "action": "submit"})


@pytest.mark.parametrize("marker,value,unit", [
    ("ca_125", "12.500", "U/mL"), ("he4", "21.50", "pmol/L"),
    ("roma", "0.83", "Chỉ số"), ("afp", "0", "IU/mL"), ("beta_hcg", "1.250", "mIU/mL"),
])
def test_unit_is_required_on_submission_but_incomplete_draft_is_preserved(auth_client, units_form, marker, value, unit):
    record, data = draft(auth_client, units_form, **{marker: value})
    saved = save(auth_client, record, data)
    assert saved.status_code == 200, saved.text
    failed = submit(auth_client, saved.json())
    assert failed.status_code == 422 and CONTRACT["fields"][marker + "_unit"] in failed.text
    data["clinical_data"][marker + "_unit"] = unit
    saved = save(auth_client, saved.json(), data)
    assert saved.status_code == 200, saved.text
    sent = submit(auth_client, saved.json())
    assert sent.status_code == 200, sent.text
    clinical = sent.json()["answers"]["clinical_data"]
    assert clinical[marker] == value and clinical[marker + "_unit"] == unit
    reread = auth_client.get(f"/api/v1/records/{record['submission_uuid']}").json()
    assert reread["answers"]["clinical_data"][marker] == value


def test_absent_lab_results_do_not_require_units(auth_client, units_form):
    record, data = draft(auth_client, units_form)
    saved = save(auth_client, record, data)
    assert saved.status_code == 200
    assert submit(auth_client, saved.json()).status_code == 200


@pytest.mark.parametrize("marker", list(CONTRACT["biomarkers"]))
def test_units_outside_pinned_choices_are_rejected(auth_client, units_form, marker):
    record, data = draft(auth_client, units_form, **{marker: "12.5", marker + "_unit": "invalid-unlisted-unit"})
    assert save(auth_client, record, data).status_code == 422


def test_other_unit_requires_description_and_never_converts_the_number(auth_client, units_form):
    record, data = draft(auth_client, units_form, afp="12.500", afp_unit="Khác")
    saved = save(auth_client, record, data)
    assert saved.status_code == 200
    assert submit(auth_client, saved.json()).status_code == 422
    data["clinical_data"]["afp_unit_other"] = "µg/L"
    saved = save(auth_client, saved.json(), data)
    assert saved.status_code == 200
    sent = submit(auth_client, saved.json())
    assert sent.status_code == 200, sent.text
    assert sent.json()["answers"]["clinical_data"]["afp"] == "12.500"
    inconsistent = deepcopy(data)
    inconsistent["clinical_data"]["afp_unit"] = "ng/mL"
    assert save(auth_client, sent.json(), inconsistent).status_code == 422
    inconsistent["clinical_data"]["afp_unit_other"] = ""
    corrected = save(auth_client, sent.json(), inconsistent)
    assert corrected.status_code == 200, corrected.text
    assert corrected.json()["answers"]["clinical_data"]["afp"] == "12.500"


@pytest.mark.parametrize("other", ["x" * 201, 123])
def test_other_unit_description_has_a_bounded_text_format(auth_client, units_form, other):
    record, data = draft(auth_client, units_form, he4="1", he4_unit="Khác", he4_unit_other=other)
    assert save(auth_client, record, data).status_code == 422


@pytest.mark.parametrize("hospital,unit", [("TD", "IU/mL"), ("HV", "ng/mL"), ("TD", "Chưa xác nhận")])
def test_unit_comes_from_the_report_and_is_not_inferred_from_hospital(auth_client, units_form, hospital, unit):
    record, data = draft(auth_client, units_form, hospital_code=hospital, afp="12.5", afp_unit=unit)
    saved = save(auth_client, record, data)
    assert saved.status_code == 200
    sent = submit(auth_client, saved.json())
    assert sent.status_code == 200, sent.text
    assert sent.json()["answers"]["clinical_data"]["afp_unit"] == unit


def test_legacy_form_keeps_missing_units_and_original_value_after_new_version(auth_client, db_session):
    record, data = draft(auth_client, 1, afp="12.500")
    saved = save(auth_client, record, data)
    assert saved.status_code == 200
    publish_biomarker_units(db_session, apply=True)
    sent = submit(auth_client, saved.json())
    assert sent.status_code == 200, sent.text
    clinical = sent.json()["answers"]["clinical_data"]
    assert clinical["afp"] == "12.500" and not any(key in clinical for key in BIOMARKER_UNIT_FIELDS)
    rows = list(csv.reader(io.StringIO(auth_client.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    assert rows[1][rows[0].index("AFP")] == "12.500"
    assert all(rows[1][rows[0].index(CONTRACT["fields"][key])] == "" for key in BIOMARKER_UNIT_FIELDS)


def test_all_five_values_and_units_have_separate_csv_and_excel_columns(auth_client, units_form):
    values = {"ca_125": "12.500", "ca_125_unit": "kU/L", "he4": "21.50", "he4_unit": "pmol/L",
              "roma": "0.83", "roma_unit": "Chỉ số", "afp": "7.125", "afp_unit": "IU/mL",
              "beta_hcg": "1.25", "beta_hcg_unit": "Khác", "beta_hcg_unit_other": "Đơn vị gốc giả lập"}
    record, data = draft(auth_client, units_form, **values)
    saved = save(auth_client, record, data)
    assert saved.status_code == 200
    assert submit(auth_client, saved.json()).status_code == 200
    rows = list(csv.reader(io.StringIO(auth_client.get("/api/v1/admin/export.csv").content.decode("utf-8-sig"))))
    book = load_workbook(io.BytesIO(auth_client.get("/api/v1/admin/export.xlsx").content), read_only=True)
    excel = list(book.active.values)
    assert rows[0] == list(excel[0]) and len(rows[0]) == len(set(rows[0]))
    for key, value in values.items():
        index = rows[0].index(CONTRACT["fields"][key])
        assert rows[1][index] == value
        if key in CONTRACT["biomarkers"]:
            assert Decimal(str(excel[1][index])) == Decimal(value)
        else:
            assert excel[1][index] == value
    book.close()
