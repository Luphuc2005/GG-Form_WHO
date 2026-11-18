"""Updated study choices without reinterpreting earlier clinical data."""
from copy import deepcopy
import uuid
import pytest
from app.models.submission import Submission


def draft(client):
    response = client.post("/api/v1/records", json={"submission_uuid": str(uuid.uuid4()), "form_version": 1})
    assert response.status_code == 201
    return response.json()


def answers(**values):
    return {"pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]},
            "clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": str(uuid.uuid4()), **values}}


def save(client, row, data):
    return client.put(f"/api/v1/records/{row['submission_uuid']}", json={"revision": row["revision"], "answers": data})


@pytest.mark.parametrize("side,shape,frozen", [
    ("Trái", "Nang đơn thùy", "Không"),
    ("Phải", "Nang đa thùy", "Lành tính"),
    ("2 bên", "U đặc", "Ác tính"),
])
def test_new_imaging_and_frozen_section_choices_can_be_saved_and_sent(auth_client, side, shape, frozen):
    row = draft(auth_client)
    data = answers(sa_so_luong_u=side, mri_so_luong_u=side, mri_dang_ton_thuong=shape, pt_sinh_thiet_lanh=frozen)
    saved = save(auth_client, row, data)
    assert saved.status_code == 200, saved.text
    result = auth_client.post(f"/api/v1/records/{row['submission_uuid']}/transition", json={"revision": saved.json()["revision"], "action": "submit"})
    assert result.status_code == 200, result.text
    clinical = result.json()["answers"]["clinical_data"]
    assert (clinical["sa_so_luong_u"], clinical["mri_so_luong_u"], clinical["mri_dang_ton_thuong"], clinical["pt_sinh_thiet_lanh"]) == (side, side, shape, frozen)


@pytest.mark.parametrize("field,value", [
    ("sa_so_luong_u", "1 bên"), ("mri_so_luong_u", "1 bên"),
    ("mri_dang_ton_thuong", "Nang và đặc"), ("mri_dang_ton_thuong", "chứa mỡ"), ("mri_dang_ton_thuong", "Nang"),
    ("pt_sinh_thiet_lanh", "Có"), ("pt_dich_o_bung", "Không có"),
])
def test_retired_choices_cannot_be_entered_into_new_records(auth_client, field, value):
    row = draft(auth_client)
    assert save(auth_client, row, answers(**{field: value})).status_code == 422


def test_doctor_can_correct_legacy_record_without_losing_or_reclassifying_old_values(auth_client, db_session):
    row = draft(auth_client)
    legacy = answers(sa_so_luong_u="1 bên", mri_so_luong_u="1 bên", mri_dang_ton_thuong="Nang và đặc",
        pt_sinh_thiet_lanh="Có", pt_sinh_thiet_lanh_ghi_chu="KẾT QUẢ GIẢ CŨ", pt_dich_o_bung="Lượng ít (< 100ml)")
    legacy["clinical_data"].pop("study_phase")
    legacy["clinical_data"]["encounter_code"] = "OLD-EPISODE"
    sub = db_session.get(Submission, row["id"])
    sub.identity_version, sub.workflow_status, sub.answers = 1, "submitted", deepcopy(legacy)
    db_session.commit()
    correction = deepcopy(legacy)
    correction["clinical_data"]["ca_125"] = "12.5"
    response = save(auth_client, row, correction)
    assert response.status_code == 200, response.text
    clinical = response.json()["answers"]["clinical_data"]
    for key, value in legacy["clinical_data"].items():
        assert clinical[key] == value
    exported = auth_client.get("/api/v1/admin/export.csv").text
    assert "KẾT QUẢ GIẢ CŨ" in exported and "Lượng ít (< 100ml)" in exported
    correction["clinical_data"]["sa_so_luong_u"] = "Trái"
    changed = save(auth_client, response.json(), correction)
    assert changed.status_code == 200
    correction["clinical_data"]["sa_so_luong_u"] = "1 bên"
    assert save(auth_client, changed.json(), correction).status_code == 422


def test_form_contract_exposes_only_the_requested_current_choices(client):
    data = client.get("/api/v1/forms/clinical-contract").json()
    assert data["choices"]["sa_so_luong_u"] == ["Trái", "Phải", "2 bên"]
    assert data["choices"]["mri_so_luong_u"] == ["Trái", "Phải", "2 bên"]
    assert data["choices"]["mri_dang_ton_thuong"] == ["Nang đơn thùy", "Nang đa thùy", "U đặc"]
    assert data["choices"]["pt_sinh_thiet_lanh"] == ["Không", "Lành tính", "Ác tính"]
    assert "pt_dich_o_bung" in data["retired_fields"]
    assert data["choices"]["mri_tang_sinh_mach_mau"] == ["Không tăng sinh", "Tăng sinh ít", "Tăng sinh nhiều", "Không đánh giá"]


@pytest.mark.parametrize("value", ["Không tăng sinh", "Tăng sinh ít", "Tăng sinh nhiều", "Không đánh giá"])
def test_mri_vascularity_is_saved_and_exported_separately_from_ultrasound(auth_client, value):
    import io
    from openpyxl import load_workbook
    row = draft(auth_client)
    response = save(auth_client, row, answers(mri_tang_sinh_mach_mau=value, sa_tang_sinh_mach_mau="2"))
    assert response.status_code == 200, response.text
    stored = response.json()
    assert stored["answers"]["clinical_data"]["mri_tang_sinh_mach_mau"] == value
    sent = auth_client.post(f"/api/v1/records/{row['submission_uuid']}/transition", json={"revision": stored["revision"], "action": "submit"})
    assert sent.status_code == 200, sent.text
    workbook = load_workbook(io.BytesIO(auth_client.get("/api/v1/admin/export.xlsx").content), read_only=True)
    rows = list(workbook.active.values)
    labels = rows[0]
    assert labels.index("Tăng sinh mạch máu (MRI)") == labels.index("Khuếch tán") + 1
    assert rows[1][labels.index("Tăng sinh mạch máu (MRI)")] == value
    assert rows[1][labels.index("Tăng sinh mạch máu")] == "2"
    workbook.close()


def test_mri_vascularity_rejects_values_outside_its_own_choices(auth_client):
    row = draft(auth_client)
    assert save(auth_client, row, answers(mri_tang_sinh_mach_mau="2")).status_code == 422
