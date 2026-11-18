"""Study IDs: atomic allocation, immutable identity, legacy compatibility and exports."""
import io
import uuid
from concurrent.futures import ThreadPoolExecutor
import pytest
from openpyxl import load_workbook
from sqlalchemy import create_engine, select, func
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.models.study_sequence import StudySequence
from app.core.security import create_access_token
from app.core.exceptions import ConflictException
from app.api.v1.records import write_change


def entry(client, hospital="YD", phase="R", **extra):
    headers = {"X-Draft-Key": uuid.uuid4().hex * 2}
    created = client.post("/api/v1/public/records", headers=headers,
        json={"submission_uuid": str(uuid.uuid4()), "form_version": 1}).json()
    clinical = {"hospital_code": hospital, "study_phase": phase, "so_hs": str(uuid.uuid4()), **extra}
    answers = {"pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]}, "clinical_data": clinical}
    saved = client.put(f"/api/v1/public/records/{created['submission_uuid']}", headers=headers,
        json={"revision": created["revision"], "answers": answers})
    assert saved.status_code == 200, saved.text
    return saved.json(), headers, answers


def send(client, row, headers):
    return client.post(f"/api/v1/public/records/{row['submission_uuid']}/submit", headers=headers,
        json={"revision": row["revision"]})


def doctor():
    return {"Authorization": "Bearer " + create_access_token({"sub": "admin"})}


def test_allocates_on_submit_and_does_not_reset_by_year(client, db_session):
    first, headers, _ = entry(client, nam_kham="2025", encounter_code="FORGED_99999")
    assert first["study_code"] is None and first["answers"]["clinical_data"]["encounter_code"] == ""
    assert db_session.scalar(select(func.count()).select_from(StudySequence)) == 0
    sent = send(client, first, headers)
    assert sent.status_code == 200, sent.text
    assert sent.json()["study_code"] == "YD_R_00001"
    assert send(client, first, headers).json()["study_code"] == "YD_R_00001"
    for hospital, phase, year, expected in [
        ("YD", "R", "2026", "YD_R_00002"),
        ("HV", "R", "2026", "HV_R_00001"),
        ("YD", "P", "2026", "YD_P_00001"),
    ]:
        row, key, _ = entry(client, hospital, phase, nam_kham=year)
        assert send(client, row, key).json()["study_code"] == expected
    saved = client.get(f"/api/v1/records/{first['submission_uuid']}", headers=doctor()).json()
    assert saved["answers"]["clinical_data"]["encounter_code"] == "YD_R_00001"
    found = client.get("/api/v1/records?q=YD_R_00001", headers=doctor()).json()
    assert found["total"] == 1
    workbook = load_workbook(io.BytesIO(client.get("/api/v1/admin/export.xlsx", headers=doctor()).content))
    sheet = workbook.active
    labels = [cell.value for cell in sheet[1]]
    removed_labels = {"Ngày điều trị/phẫu thuật", "Trạng thái phiếu", "Người nhập", "Người duyệt", "Thời gian duyệt", "Lý do thiếu dữ liệu (mã biến)"}
    assert removed_labels.isdisjoint(labels)
    assert labels[0] == "Mã phiếu" and "ID đồng bộ" not in labels
    assert "Mã nghiên cứu" not in labels
    assert "YD_R_00001" in [row[labels.index("Mã phiếu")] for row in sheet.iter_rows(min_row=2, values_only=True)]
    workbook.close()


def test_issued_identity_is_fixed_and_cancelled_numbers_are_never_reused(client, db_session):
    row, key, answers = entry(client)
    assert send(client, row, key).status_code == 200
    path = f"/api/v1/records/{row['submission_uuid']}"
    current = client.get(path, headers=doctor()).json()
    answers["clinical_data"]["ca_125"] = "12.3"
    corrected = client.put(path, headers=doctor(), json={"revision": current["revision"], "answers": answers})
    assert corrected.status_code == 200
    assert corrected.json()["study_code"] == "YD_R_00001"
    assert db_session.get(StudySequence, ("YD", "R")).last_value == 1
    answers["clinical_data"]["hospital_code"] = "TD"
    invalid = client.put(path, headers=doctor(), json={"revision": corrected.json()["revision"], "answers": answers})
    assert invalid.status_code == 422
    cancelled = client.post(path + "/transition", headers=doctor(), json={"revision": corrected.json()["revision"], "action": "cancel", "note": "Synthetic cancellation"})
    assert cancelled.status_code == 200
    next_row, next_key, _ = entry(client)
    assert send(client, next_row, next_key).json()["study_code"] == "YD_R_00002"


@pytest.mark.parametrize("hospital,phase", [("", "R"), ("YD", "")])
def test_requires_hospital_and_phase_before_issuing_code(client, db_session, hospital, phase):
    row, key, _ = entry(client, hospital, phase)
    assert send(client, row, key).status_code == 422
    assert db_session.scalar(select(func.count()).select_from(StudySequence)) == 0


def test_counter_limit_rolls_back_and_failed_submit_does_not_take_a_number(client, db_session):
    row, key, _ = entry(client)
    db_session.add(StudySequence(hospital_code="YD", phase="R", last_value=99999))
    db_session.commit()
    assert send(client, row, key).status_code == 422
    assert db_session.get(StudySequence, ("YD", "R")).last_value == 99999
    assert db_session.get(Submission, row["id"]).study_code is None


def test_legacy_record_keeps_its_old_episode_identity_when_corrected(client, db_session):
    row, _, _ = entry(client)
    legacy = {"pathology": {"selected": [{"id": "serous_cystadenoma_8441_0"}]},
              "clinical_data": {"hospital_code": "OLD-HOSPITAL", "so_hs": "OLD-001", "encounter_code": "OLD-EPISODE"}}
    sub = db_session.get(Submission, row["id"])
    sub.identity_version, sub.workflow_status, sub.answers = 1, "submitted", legacy
    db_session.commit()
    legacy["clinical_data"]["ca_125"] = "17.5"
    response = client.put(f"/api/v1/records/{row['submission_uuid']}", headers=doctor(), json={"revision": sub.revision, "answers": legacy})
    assert response.status_code == 200, response.text
    assert response.json()["study_code"] is None and response.json()["identity_version"] == 1
    assert response.json()["encounter_code"] == "OLD-EPISODE"
    assert db_session.scalar(select(func.count()).select_from(StudySequence)) == 0


@pytest.mark.parametrize("hospital,expected", [("UB", 1), ("YD", 0)])
def test_cancer_center_indicator_is_derived_from_hospital(client, hospital, expected):
    row, key, _ = entry(client, hospital, hospital_cancer_center=1-expected)
    assert row["answers"]["clinical_data"]["hospital_cancer_center"] == expected
    assert send(client, row, key).status_code == 200


@pytest.fixture
def file_database(tmp_path):
    engine = create_engine(f"sqlite:///{(tmp_path/'study.db').as_posix()}", connect_args={"timeout": 20, "check_same_thread": False})
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    with factory() as db:
        form = FormVersion(form_key="synthetic", version=1, schema_hash="synthetic", schema_json={})
        db.add(form); db.flush()
        rows = [Submission(submission_uuid=uuid.uuid4(), form_version_id=form.id, payload_hash="synthetic", classification="benign", answers={}, workflow_status="draft", identity_version=2) for _ in range(8)]
        db.add_all(rows); db.commit()
        ids = [row.id for row in rows]
    yield factory, ids
    engine.dispose()


def submitted_changes(identifier):
    return {"workflow_status": "submitted", "answers": {"clinical_data": {"hospital_code": "TD", "study_phase": "R", "so_hs": str(identifier)}}}


def test_simultaneous_submissions_receive_distinct_codes(file_database):
    factory, ids = file_database
    def submit(identifier):
        with factory() as db:
            sub = db.get(Submission, identifier)
            return write_change(db, sub, None, submitted_changes(identifier), "submit")["study_code"]
    with ThreadPoolExecutor(max_workers=4) as pool:
        codes = list(pool.map(submit, ids))
    assert sorted(codes) == [f"TD_R_{number:05d}" for number in range(1, 9)]


def test_stale_submit_rolls_back_allocated_number(file_database):
    factory, ids = file_database
    with factory() as first, factory() as stale:
        original = first.get(Submission, ids[0])
        outdated = stale.get(Submission, ids[0])
        write_change(first, original, None, submitted_changes(ids[0]), "submit")
        with pytest.raises(ConflictException):
            write_change(stale, outdated, None, submitted_changes(ids[0]), "submit")
    with factory() as db:
        assert db.get(StudySequence, ("TD", "R")).last_value == 1
