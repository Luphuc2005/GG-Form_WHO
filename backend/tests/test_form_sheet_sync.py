"""Durable schema jobs use synthetic destinations only."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.database import Base
from app.models.form_management import FormSheetJob
from app.models.form_version import FormVersion
from app.services import form_sheet_sync as jobs
from app.services.form_configuration import FORM_KEY, effective_schema
from app.services import google_sheets_svc as sheets
from app.models.submission import Submission
import uuid


def test_schema_job_is_durable_without_any_patient_records_and_retries(monkeypatch):
    engine=create_engine("sqlite:///:memory:");Base.metadata.create_all(engine)
    factory=sessionmaker(bind=engine,expire_on_commit=False)
    settings=SimpleNamespace(GOOGLE_SHEETS_WEBHOOK_URL="synthetic",GOOGLE_SHEETS_SPREADSHEET_ID="synthetic")
    with factory() as db:
        db.add(FormSheetJob(form_key=FORM_KEY,target_version=2,status="pending"));db.commit()
    calls=[]
    def fail(_db):
        calls.append(1);raise RuntimeError("synthetic failure, never leak this value")
    monkeypatch.setattr(jobs,"ensure_schema",fail)
    assert jobs.process_schema_job(factory,settings)
    with factory() as db:
        job=db.get(FormSheetJob,FORM_KEY)
        assert job.status == "failed" and "never leak" not in job.error
        job.attempted_at=datetime.now(timezone.utc)-timedelta(minutes=2);db.commit()
    monkeypatch.setattr(jobs,"ensure_schema",lambda _db:calls.append(2))
    assert jobs.process_schema_job(factory,settings)
    assert not jobs.process_schema_job(factory,settings)
    with factory() as db:
        assert db.get(FormSheetJob,FORM_KEY).status == "synced"
    assert calls==[1,2]
    engine.dispose()


def test_schema_update_requires_matching_headers_on_readback(db_session,monkeypatch):
    old=db_session.query(FormVersion).first()
    schema=effective_schema(old.schema_json);schema.version=2
    next(f for f in schema.clinical_fields if f.id=="ho_ten").label="Tên mới thử nghiệm"
    db_session.add(FormVersion(form_key=FORM_KEY,version=2,status="published",schema_json=schema.model_dump(mode="json"),schema_hash="synthetic"));db_session.commit()
    headers=["Mã phiếu","Họ Tên"]
    monkeypatch.setattr(sheets,"_read_sheet_data",lambda:(headers,{},[]))
    sent=[]
    def send(payload,expected_status):
        sent.append(payload)
        assert expected_status=="schema_updated"
        headers[:]=[d["label"] for d in payload["columns"] if d["export"]]
    monkeypatch.setattr(sheets,"_send_webhook",send)
    jobs.ensure_schema(db_session)
    assert len(sent)==1 and sent[0]["schema_version"]==2
    renamed=next(d for d in sent[0]["columns"] if d["key"]=="ho_ten")
    assert "Họ Tên" in renamed["aliases"] and renamed["label"]=="Tên mới thử nghiệm"
    jobs.ensure_schema(db_session)
    assert len(sent)==1


def test_numeric_display_normalization_for_new_and_renamed_questions():
    assert sheets.same_sheet_row(["Điểm mới"],["1.00"],["1"],{"Điểm mới"})
    assert not sheets.same_sheet_row(["Mã mới"],["0001"],["1"],set())


def test_legacy_sheet_adds_only_ultrasound_conclusion_when_collected(db_session, monkeypatch):
    form = db_session.query(FormVersion).first()
    db_session.add(Submission(
        submission_uuid=uuid.uuid4(), form_version_id=form.id, payload_hash="synthetic",
        classification="unspecified", workflow_status="submitted",
        answers={"clinical_data": {"sa_ket_luan": "Synthetic conclusion"}},
    ))
    db_session.commit()
    headers = ["Mã phiếu", "Số HS", "Mã nghiên cứu", "PARA"]
    monkeypatch.setattr(sheets, "_read_sheet_data", lambda: (headers, {}, []))
    sent = []

    def send(payload, expected_status):
        assert expected_status == "schema_updated"
        assert payload["preserve_column_order"]
        sent.append(payload)
        headers[:] = [column["label"] for column in payload["columns"] if column["export"]]

    monkeypatch.setattr(sheets, "_send_webhook", send)
    jobs.ensure_schema(db_session)
    assert headers == ["Mã phiếu", "Số HS", "Mã nghiên cứu", "PARA", "Kết luận siêu âm"]
    assert [column["key"] for column in sent[0]["columns"]] == [
        "submission_uuid", "so_hs", "study_code", "para", "sa_ket_luan",
    ]
    jobs.ensure_schema(db_session)
    assert len(sent) == 1


def test_legacy_mri_columns_are_recognized_before_managed_form_publication(db_session, monkeypatch):
    from app.services.form_configuration import export_definitions

    definitions, managed = export_definitions(db_session)
    assert not managed
    columns = {column["key"]: column for column in definitions}
    for key in ("mri_dich_nang_t1w", "mri_dich_nang_t2w"):
        assert columns[key]["export"] and columns[key]["label"] in columns[key]["aliases"]
    headers = [columns[key]["label"] for key in ("submission_uuid", "so_hs", "mri_dich_nang_t1w", "mri_dich_nang_t2w")]
    expected = [column["label"] for column in definitions if column["export"]]
    row = list(range(len(expected)))
    fitted_headers, fitted = sheets.fit_sheet_columns(headers, expected, row)
    assert fitted_headers == headers
    assert fitted == [expected.index(label) for label in headers]


def test_schema_recovery_releases_exhausted_record_and_removal_jobs(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    factory = sessionmaker(bind=engine, expire_on_commit=False)
    settings = SimpleNamespace(GOOGLE_SHEETS_WEBHOOK_URL="synthetic", GOOGLE_SHEETS_SPREADSHEET_ID="synthetic")
    with factory() as db:
        form = FormVersion(form_key=FORM_KEY, version=2, status="published", schema_json={}, schema_hash="synthetic")
        db.add(form)
        db.flush()
        db.add(FormSheetJob(form_key=FORM_KEY, target_version=2, status="pending"))
        for state in ("submitted", "cancelled", "trashed"):
            db.add(Submission(submission_uuid=uuid.uuid4(), form_version_id=form.id, payload_hash="synthetic",
                              answers={}, workflow_status=state, classification="unspecified",
                              sync_status="failed", sync_attempts=5, sync_error="Cấu trúc cột Sheet khác biểu mẫu xuất dữ liệu."))
        db.commit()
    monkeypatch.setattr(jobs, "ensure_schema", lambda _db: None)
    assert jobs.process_schema_job(factory, settings)
    with factory() as db:
        assert db.get(FormSheetJob, FORM_KEY).status == "synced"
        records = db.query(Submission).all()
        assert len(records) == 3
        assert all(record.sync_status == "pending" and record.sync_attempts == 0 and record.sync_error is None for record in records)
    engine.dispose()


def test_managed_export_groups_columns_and_hides_derived_fields(db_session):
    from app.services.form_configuration import export_definitions

    old = db_session.query(FormVersion).first()
    schema = effective_schema(old.schema_json)
    schema.version = 2
    db_session.add(FormVersion(form_key=FORM_KEY, version=2, status="published", schema_json=schema.model_dump(mode="json"), schema_hash="synthetic-grouped"))
    db_session.commit()
    definitions, managed = export_definitions(db_session)
    assert managed
    exported = [column for column in definitions if column["export"]]
    keys = [column["key"] for column in exported]
    assert keys[:7] == ["submission_uuid", "study_code", "created_at", "so_hs", "ho_ten", "hospital_code", "study_phase"]
    assert keys.index("mri_dich_nang_t1w") < keys.index("mri_dich_nang_t2w") < keys.index("pt_so_luong_u")
    assert keys.index("sa_ket_luan") < keys.index("mri_so_luong_u")
    assert keys.index("pt_co_dich_o_bung") < keys.index("pt_co_dich_o_bung_ghi_chu") < keys.index("pt_u_dinh_co_quan_khac")
    columns = {column["key"]: column for column in exported}
    assert all(columns[key]["hidden"] for key in ("submission_uuid", "encounter_code", "hospital_cancer_center", "mri_dich_nang"))
    assert columns["pt_so_luong_u"]["section"] == "sec6"


def test_new_code_fields_are_not_enabled_outside_a_published_managed_schema(db_session):
    from app.services.form_configuration import export_definitions
    from app.services.clinical_validation import SURGERY_FIELDS

    old = db_session.query(FormVersion).first()
    schema = effective_schema(old.schema_json)
    schema.version = 2
    schema.clinical_fields = [field for field in schema.clinical_fields if field.id not in SURGERY_FIELDS]
    db_session.add(FormVersion(form_key=FORM_KEY, version=2, status="published", schema_json=schema.model_dump(mode="json"), schema_hash="synthetic-old-managed"))
    db_session.commit()
    definitions, managed = export_definitions(db_session)
    assert managed
    columns = {column["key"]: column for column in definitions}
    assert all(not columns[key]["export"] for key in SURGERY_FIELDS)


def test_layout_is_initialized_even_if_column_names_already_match(db_session, monkeypatch):
    from app.services.form_configuration import export_definitions

    old = db_session.query(FormVersion).first()
    schema = effective_schema(old.schema_json)
    schema.version = 2
    db_session.add(FormVersion(form_key=FORM_KEY, version=2, status="published", schema_json=schema.model_dump(mode="json"), schema_hash="synthetic-layout"))
    db_session.commit()
    definitions, _ = export_definitions(db_session)
    headers = [column["label"] for column in definitions if column["export"]]
    monkeypatch.setattr(sheets, "_sheet_layout_version", 1)
    monkeypatch.setattr(sheets, "_sheet_layout_applied", False)
    monkeypatch.setattr(sheets, "_read_sheet_data", lambda: (headers, {}, []))
    sent = []

    def send(payload, expected_status):
        assert payload["organize_columns"] and not payload["preserve_column_order"]
        sent.append(payload)
        sheets._sheet_layout_applied = True

    monkeypatch.setattr(sheets, "_send_webhook", send)
    jobs.ensure_schema(db_session)
    jobs.ensure_schema(db_session)
    assert len(sent) == 1
