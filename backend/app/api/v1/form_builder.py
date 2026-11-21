"""Admin-only, versioned form configuration; publishing never rewrites old records."""
import hashlib
import json
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import update, delete
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.form_version import FormVersion
from app.models.form_management import FormDraft, FormSheetJob
from app.models.submission import Submission, EXPORTABLE_STATES
from app.repositories.form_repo import FormRepository
from app.schemas.form import FormSchemaDefinition
from app.services.auth_svc import AuthService
from app.services.form_configuration import FORM_KEY, SECTIONS, all_versions, effective_schema, validate_configuration, export_definitions, organize_export_definitions
from app.core.exceptions import ConflictException, NotFoundException

router = APIRouter(prefix="/admin/form-builder", tags=["Form configuration"])


class ConfigurationChange(BaseModel):
    base_version: int = Field(ge=1)
    draft_revision: int = Field(default=0, ge=0)
    definition: FormSchemaDefinition = Field(alias="schema")


def latest_form(db):
    current = FormRepository.get_published_by_key(db, FORM_KEY)
    if not current:
        raise NotFoundException("Chưa có biểu mẫu được công bố.")
    return current


def check_change(db, payload):
    current = latest_form(db)
    if payload.base_version != current.version:
        raise ConflictException("Đã có phiên bản biểu mẫu mới. Tải lại để đối chiếu trước khi sửa tiếp.")
    validate_configuration(payload.definition, current.schema_json, all_versions(db))
    return current


@router.get("")
def read_builder(db: Session = Depends(get_db), user=Depends(AuthService.require_form_admin)):
    current = latest_form(db)
    draft = db.get(FormDraft, FORM_KEY)
    job = db.get(FormSheetJob, FORM_KEY)
    return {"base_version": current.version, "schema": effective_schema(current.schema_json), "sections": SECTIONS,
        "draft": {"revision": draft.revision, "base_version": draft.base_version, "schema": draft.schema_json, "updated_by": draft.updated_by, "updated_at": draft.updated_at} if draft else None,
        "sheet": {"status": job.status, "error": job.error, "target_version": job.target_version} if job else {"status": "legacy", "error": None},
        "versions": [{"version": f.version, "published_at": f.published_at, "title": f.schema_json.get("title")} for f in reversed(all_versions(db))]}


@router.put("/draft")
def save_configuration_draft(payload: ConfigurationChange, db: Session = Depends(get_db), user=Depends(AuthService.require_form_admin)):
    check_change(db, payload)
    now = datetime.now(timezone.utc)
    draft = db.get(FormDraft, FORM_KEY)
    if draft:
        count = db.execute(update(FormDraft).where(FormDraft.form_key == FORM_KEY, FormDraft.revision == payload.draft_revision).values(
            schema_json=payload.definition.model_dump(mode="json"), revision=FormDraft.revision+1, base_version=payload.base_version, updated_by=user.username, updated_at=now), execution_options={"synchronize_session": False}).rowcount
        if count != 1:
            db.rollback()
            raise ConflictException("Bản nháp đã thay đổi ở phiên khác. Tải lại trước khi lưu.")
    else:
        if payload.draft_revision:
            raise ConflictException("Bản nháp đã được xuất bản. Tải lại cấu hình.")
        db.add(FormDraft(form_key=FORM_KEY, revision=1, base_version=payload.base_version, schema_json=payload.definition.model_dump(mode="json"), updated_by=user.username, updated_at=now))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictException("Bản nháp đã thay đổi ở phiên khác. Tải lại trước khi lưu.")
    db.expire_all()
    return {"draft_revision": db.get(FormDraft, FORM_KEY).revision}


@router.post("/preview")
def preview_configuration(payload: ConfigurationChange, db: Session = Depends(get_db), user=Depends(AuthService.require_form_admin)):
    current = check_change(db, payload)
    before = {f.id: f for f in effective_schema(current.schema_json).clinical_fields}
    changes = []
    for field in payload.definition.clinical_fields:
        if field.id not in before:
            changes.append(f"Thêm câu hỏi: {field.label}")
        elif field != before[field.id]:
            changes.append(f"Cập nhật: {before[field.id].label} → {field.label}" + (" (ngừng dùng)" if not field.active else ""))
    if payload.definition.fields != FormSchemaDefinition.model_validate(current.schema_json).fields:
        changes.append("Cập nhật danh mục giải phẫu bệnh WHO")
    definitions, _ = export_definitions(db)
    by_key = {d["key"]: d for d in definitions}
    for field in payload.definition.clinical_fields:
        by_key[field.id] = {"key": field.id, "label": field.label, "export": field.export}
    columns = organize_export_definitions(list(by_key.values()), payload.definition.clinical_fields)
    return {"schema": payload.definition, "changes": changes, "columns": [d for d in columns if d["export"] and d["key"] != "submission_uuid"],
            "message": "Phiếu cũ giữ phiên bản đã nhập. Trường mới để trống trên phiếu cũ. Excel tải mới dùng bộ cột mới; Sheet cập nhật qua hàng đợi."}


@router.post("/publish")
def publish_configuration(payload: ConfigurationChange, db: Session = Depends(get_db), user=Depends(AuthService.require_form_admin)):
    current = check_change(db, payload)
    draft = db.get(FormDraft, FORM_KEY)
    if (draft.revision if draft else 0) != payload.draft_revision:
        raise ConflictException("Bản nháp đã thay đổi ở phiên khác. Tải lại trước khi xuất bản.")
    schema = payload.definition.model_copy(deep=True)
    schema.version = current.version + 1
    raw = schema.model_dump(mode="json")
    digest = hashlib.sha256(json.dumps(raw, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
    form = FormVersion(form_key=FORM_KEY, version=schema.version, status="published", schema_json=raw,
                       schema_hash=digest, published_at=datetime.now(timezone.utc))
    db.add(form)
    if draft:
        # CAS consumes this exact shared draft; another editor cannot lose an update.
        removed = db.execute(delete(FormDraft).where(FormDraft.form_key == FORM_KEY, FormDraft.revision == payload.draft_revision)).rowcount
        if removed != 1:
            db.rollback()
            raise ConflictException("Bản nháp đã thay đổi ở phiên khác. Tải lại trước khi xuất bản.")
    job = db.get(FormSheetJob, FORM_KEY)
    if job:
        job.target_version, job.status, job.attempts, job.error = schema.version, "pending", 0, None
    else:
        db.add(FormSheetJob(form_key=FORM_KEY, target_version=schema.version, status="pending"))
    db.execute(update(Submission).where(Submission.workflow_status.in_(EXPORTABLE_STATES), Submission.sync_status != "syncing").values(sync_status="pending", sync_attempts=0, sync_error=None))
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictException("Biểu mẫu đã được xuất bản ở phiên khác. Tải lại cấu hình.")
    return {"version": schema.version, "sheet_status": "pending", "message": "Đã xuất bản biểu mẫu. Đang chờ cập nhật cấu trúc và dữ liệu Google Sheets."}


@router.post("/retry-sheet")
def retry_sheet(db: Session = Depends(get_db), user=Depends(AuthService.require_form_admin)):
    current = latest_form(db)
    job = db.get(FormSheetJob, FORM_KEY)
    if not job:
        db.add(FormSheetJob(form_key=FORM_KEY, target_version=current.version, status="pending"))
    else:
        job.status, job.attempts, job.error = "pending", 0, None
    db.commit()
    return {"status": "pending"}
