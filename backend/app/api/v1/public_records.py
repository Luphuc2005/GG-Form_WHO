"""Direct entry. A draft key grants access only to that one unfinished form."""
import hashlib
import hmac
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.submission import Submission
from app.models.submission_event import SubmissionEvent
from app.repositories.form_repo import FormRepository
from app.schemas.submission import AnswersPayload
from app.api.v1.records import DraftCreate, DraftSave, present, write_change
from app.services.record_data import checked_answers, episode_key
from app.services.study_identity import uses_study_identity
from app.core.security import calculate_canonical_payload_hash
from app.core.exceptions import NotFoundException, ConflictException

router = APIRouter(prefix="/public/records", tags=["Direct form entry"])


def draft_hash(draft_key: str = Header(..., alias="X-Draft-Key", min_length=32, max_length=128)):
    return hashlib.sha256(draft_key.encode()).hexdigest()


def own_draft(db, key, digest):
    record = db.scalar(select(Submission).where(Submission.submission_uuid == key))
    if not record or record.workflow_status == "trashed" or not record.public_access_hash or not hmac.compare_digest(record.public_access_hash, digest):
        raise NotFoundException("Không tìm thấy bản nháp trong phiên nhập này.")
    return record


def public_view(db, record):
    if record.workflow_status == "draft":
        return present(db, record)
    # Closing a form does not grant public access to later corrections or other records.
    return {"submission_uuid": record.submission_uuid, "reference_code": str(record.submission_uuid).split("-")[0].upper(),
            "study_code": record.study_code,
            "workflow_status": record.workflow_status, "created_at": record.created_at,
            "message": "Phiếu đã được lưu vào hệ thống."}


@router.post("", status_code=201)
def create(payload: DraftCreate, digest: str = Depends(draft_hash), db: Session = Depends(get_db)):
    existing = db.scalar(select(Submission).where(Submission.submission_uuid == payload.submission_uuid))
    if existing:
        return public_view(db, own_draft(db, payload.submission_uuid, digest))
    form = FormRepository.get_by_key_and_version(db, "ovarian-pathology-who", payload.form_version)
    if not form or form.status != "published":
        raise NotFoundException("Không tải được phiên bản biểu mẫu.")
    answers = AnswersPayload().model_dump(mode="json")
    record = Submission(submission_uuid=payload.submission_uuid, form_version_id=form.id, public_access_hash=digest,
                        identity_version=2,
                        workflow_status="draft", answers=answers, classification="unspecified", payload_hash=calculate_canonical_payload_hash(answers))
    try:
        db.add(record); db.flush()
        db.add(SubmissionEvent(submission_id=record.id, action="create", revision=1, after_answers=answers))
        db.commit()
    except IntegrityError:
        db.rollback()
        return public_view(db, own_draft(db, payload.submission_uuid, digest))
    return public_view(db, record)


@router.get("/{key}")
def read(key: uuid.UUID, digest: str = Depends(draft_hash), db: Session = Depends(get_db)):
    return public_view(db, own_draft(db, key, digest))


@router.put("/{key}")
def save(key: uuid.UUID, payload: DraftSave, digest: str = Depends(draft_hash), db: Session = Depends(get_db)):
    record = own_draft(db, key, digest)
    if record.workflow_status != "draft":
        raise ConflictException("Phiếu đã gửi. Bác sĩ có thể chỉnh sửa tại trang admin.")
    answers = checked_answers(record, payload.answers)
    hashed = calculate_canonical_payload_hash(answers)
    if record.payload_hash == hashed:
        return public_view(db, record)
    if record.revision != payload.revision:
        raise ConflictException("Bản nháp đã thay đổi ở phiên khác. Tải lại trước khi nhập tiếp.")
    return write_change(db, record, None, {"answers": answers, "payload_hash": hashed, "classification": answers["classification"],
                        "encounter_key": episode_key(answers["clinical_data"], uses_study_identity(record, answers["clinical_data"]))}, "save")


class Send(BaseModel):
    revision: int = Field(ge=1)


@router.post("/{key}/submit")
def submit(key: uuid.UUID, payload: Send, digest: str = Depends(draft_hash), db: Session = Depends(get_db)):
    record = own_draft(db, key, digest)
    if record.workflow_status != "draft":
        return public_view(db, record)
    if record.revision != payload.revision:
        raise ConflictException("Bản nháp đã thay đổi ở phiên khác. Tải lại trước khi gửi.")
    answers = checked_answers(record, AnswersPayload.model_validate(record.answers), final=True)
    write_change(db, record, None, {"answers": answers, "payload_hash": calculate_canonical_payload_hash(answers),
        "classification": answers["classification"], "encounter_key": episode_key(answers["clinical_data"], uses_study_identity(record, answers["clinical_data"])),
        "workflow_status":"submitted", "submitted_at":datetime.now(timezone.utc), "sync_status":"pending", "sync_error":None, "sync_attempts":0}, "submit")
    return public_view(db, record)
