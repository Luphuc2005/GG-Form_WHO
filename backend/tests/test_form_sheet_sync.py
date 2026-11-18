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
