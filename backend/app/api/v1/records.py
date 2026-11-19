"""Authenticated episode-based data collection with optimistic concurrency."""
import uuid
from datetime import datetime, timezone
from typing import Literal
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy import select, update, or_, cast, String, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.admin_user import AdminUser
from app.models.submission import Submission, EXPORTABLE_STATES
from app.models.submission_event import SubmissionEvent
from app.repositories.form_repo import FormRepository
from app.schemas.submission import AnswersPayload
from app.services.auth_svc import AuthService
from app.services.record_data import episode_key, checked_answers
from app.services.study_identity import assign_study_code, uses_study_identity
from app.core.security import calculate_canonical_payload_hash, hash_password
from app.core.exceptions import AppException, ConflictException, NotFoundException, ValidationErrorException

router = APIRouter(prefix="/records", tags=["Clinical workflow"])
accounts_router = APIRouter(prefix="/accounts", tags=["Accounts"])
STATES = {"draft", "submitted", "changes_requested", "approved", "cancelled"}


def physician(user):
    return user.role in ("admin", "doctor")


def accessible(db, key, user, include_trash=False):
    sub = db.scalar(select(Submission).where(Submission.submission_uuid == key))
    if not sub or (not physician(user) and sub.owner_id != user.id):
        raise NotFoundException("Không tìm thấy phiếu hoặc bạn không có quyền truy cập.")
    if sub.workflow_status == "trashed" and not (include_trash and physician(user)):
        raise NotFoundException("Phiếu đang trong thùng rác. Khôi phục phiếu để sử dụng.")
    return sub


def present(db, sub, detail=True):
    owner = db.get(AdminUser, sub.owner_id) if sub.owner_id else None
    reviewer = db.get(AdminUser, sub.reviewer_id) if sub.reviewer_id else None
    clinical = (sub.answers or {}).get("clinical_data") or {}
    result = {name: getattr(sub, name) for name in ("id", "submission_uuid", "workflow_status", "revision", "created_at", "updated_at", "submitted_at", "approved_at", "review_note", "owner_id", "sync_status", "sync_error", "synced_revision", "identity_version", "study_code", "study_number")}
    result.update(reference_code=str(sub.submission_uuid).split("-")[0].upper(), form_version=sub.form_version.version,
                  trashed_at=sub.trashed_at, trashed_from_state=sub.trashed_from_state,
                  owner_name=owner.username if owner else ("Nhập form trực tiếp" if sub.public_access_hash else "Phiếu cũ — chưa gán người nhập"),
                  reviewer_name=reviewer.username if reviewer else None,
                  so_hs=clinical.get("so_hs", ""), ho_ten=clinical.get("ho_ten", ""),
                  hospital_code=clinical.get("hospital_code", ""), encounter_code=clinical.get("encounter_code", ""))
    if detail:
        result["answers"] = sub.answers
    return result


class DraftCreate(BaseModel):
    submission_uuid: uuid.UUID
    form_version: int


class DraftSave(BaseModel):
    revision: int = Field(ge=1)
    answers: AnswersPayload


class Transition(BaseModel):
    revision: int = Field(ge=1)
    action: Literal["submit", "approve", "return", "reopen", "cancel"]
    note: str = Field(default="", max_length=2000)


def write_change(db, sub, user, changes, action, note=None):
    before = sub.answers
    expected = sub.revision
    changes.update(revision=expected + 1, updated_at=datetime.now(timezone.utc))
    try:
        assign_study_code(db, sub, changes)
        count = db.execute(update(Submission).where(Submission.id == sub.id, Submission.revision == expected).values(**changes), execution_options={"synchronize_session": False}).rowcount
        if count != 1:
            db.rollback()
            raise ConflictException("Phiếu đã thay đổi ở phiên khác. Tải lại phiếu trước khi sửa tiếp.")
        db.add(SubmissionEvent(submission_id=sub.id, actor_id=user.id if user else None, action=action, revision=expected + 1,
                               note=note, before_answers=before if "answers" in changes else None,
                               after_answers=changes.get("answers")))
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictException("Đợt điều trị này đã có phiếu. Tìm phiếu hiện có để nhập tiếp; không tạo thêm.")
    except AppException:
        db.rollback()
        raise
    db.refresh(sub)
    return present(db, sub)


@router.post("", status_code=201)
def create_draft(payload: DraftCreate, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_user)):
    existing = db.scalar(select(Submission).where(Submission.submission_uuid == payload.submission_uuid))
    if existing:
        return present(db, accessible(db, payload.submission_uuid, user))
    form = FormRepository.get_by_key_and_version(db, "ovarian-pathology-who", payload.form_version)
    if not form or form.status != "published":
        raise NotFoundException("Biểu mẫu chưa được công bố.")
    answers = AnswersPayload().model_dump(mode="json")
    sub = Submission(submission_uuid=payload.submission_uuid, form_version_id=form.id, owner_id=user.id,
                     identity_version=2,
                     workflow_status="draft", answers=answers, classification="unspecified",
                     payload_hash=calculate_canonical_payload_hash(answers))
    try:
        db.add(sub)
        db.flush()
        db.add(SubmissionEvent(submission_id=sub.id, actor_id=user.id, action="create", revision=1, after_answers=answers))
        db.commit()
    except IntegrityError:
        db.rollback()
        return present(db, accessible(db, payload.submission_uuid, user))
    return present(db, sub)


@router.get("")
def list_records(q: str = Query("", max_length=200), state: str = "", owner_id: int | None = None,
                 date_from: datetime | None = None, date_to: datetime | None = None,
                 page: int = Query(1, ge=1), page_size: int = Query(20, ge=1, le=100),
                 db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_user)):
    stmt = select(Submission)
    if state == "trashed":
        if not physician(user):
            raise AppException(403, "FORBIDDEN", "Chỉ bác sĩ hoặc quản trị viên được xem thùng rác.")
        stmt = stmt.where(Submission.workflow_status == "trashed")
    else:
        stmt = stmt.where(Submission.workflow_status != "trashed")
    if not physician(user):
        stmt = stmt.where(Submission.owner_id == user.id)
    elif owner_id is not None:
        stmt = stmt.where(Submission.owner_id == owner_id)
    if state:
        if state not in STATES | {"trashed"}:
            raise ValidationErrorException("Trạng thái không hợp lệ.")
        stmt = stmt.where(Submission.workflow_status == state)
    if date_from:
        stmt = stmt.where(Submission.created_at >= date_from.astimezone(timezone.utc))
    if date_to:
        stmt = stmt.where(Submission.created_at <= date_to.astimezone(timezone.utc))
    if q.strip():
        term = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        fields = [cast(Submission.submission_uuid, String), Submission.study_code] + [Submission.answers["clinical_data"][k].as_string() for k in ("so_hs", "ho_ten", "hospital_code", "encounter_code")]
        stmt = stmt.where(or_(*(f.ilike(term, escape="\\") for f in fields)))
    total = db.scalar(select(func.count()).select_from(stmt.subquery())) or 0
    rows = db.scalars(stmt.order_by(Submission.created_at.desc(), Submission.id.desc()).offset((page-1)*page_size).limit(page_size)).all()
    return {"items": [present(db, sub, False) for sub in rows], "total": total, "page": page, "total_pages": max(1, (total+page_size-1)//page_size)}


@router.get("/{key}")
def read_record(key: uuid.UUID, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_user)):
    return present(db, accessible(db, key, user, include_trash=True))


class TrashChange(BaseModel):
    revision: int = Field(ge=1)


@router.post("/{key}/trash")
def trash_record(key: uuid.UUID, payload: TrashChange, db: Session = Depends(get_db),
                 user: AdminUser = Depends(AuthService.get_current_admin)):
    sub = accessible(db, key, user, include_trash=True)
    if sub.workflow_status == "trashed" and payload.revision == sub.revision - 1:
        return present(db, sub)
    if payload.revision != sub.revision:
        raise ConflictException("Phiếu đã thay đổi. Tải lại trước khi xóa.")
    if sub.workflow_status == "trashed":
        raise ConflictException("Phiếu đã nằm trong thùng rác.")
    return write_change(db, sub, user, {
        "trashed_from_state": sub.workflow_status,
        "trashed_at": datetime.now(timezone.utc),
        "workflow_status": "trashed",
        "sync_status": "syncing" if sub.sync_status == "syncing" else "pending",
        "sync_error": None,
        "sync_attempts": 0,
    }, "trash")


@router.post("/{key}/restore")
def restore_record(key: uuid.UUID, payload: TrashChange, db: Session = Depends(get_db),
                   user: AdminUser = Depends(AuthService.get_current_admin)):
    sub = accessible(db, key, user, include_trash=True)
    if sub.workflow_status != "trashed":
        if payload.revision == sub.revision - 1 and db.scalar(
            select(SubmissionEvent.id).where(
                SubmissionEvent.submission_id == sub.id,
                SubmissionEvent.revision == sub.revision,
                SubmissionEvent.action == "restore",
            )
        ):
            return present(db, sub)
        raise ConflictException("Phiếu không nằm trong thùng rác.")
    if payload.revision != sub.revision:
        raise ConflictException("Phiếu đã thay đổi. Tải lại trước khi khôi phục.")
    if sub.trashed_from_state not in STATES:
        raise ConflictException("Không xác định được trạng thái trước khi xóa. Cần kiểm tra phiếu.")
    return write_change(db, sub, user, {
        "workflow_status": sub.trashed_from_state,
        "trashed_from_state": None,
        "trashed_at": None,
        "sync_status": "syncing" if sub.sync_status == "syncing" else "pending",
        "sync_error": None,
        "sync_attempts": 0,
    }, "restore")


@router.put("/{key}")
def save_draft(key: uuid.UUID, payload: DraftSave, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_user)):
    sub = accessible(db, key, user)
    is_admin_edit = physician(user) and sub.workflow_status in EXPORTABLE_STATES
    if sub.workflow_status not in ("draft", "changes_requested") and not is_admin_edit:
        raise ConflictException("Phiếu đã gửi hoặc đã khóa. Cần bác sĩ mở lại trước khi sửa.")
    answers = checked_answers(sub, payload.answers, final=is_admin_edit)
    digest = calculate_canonical_payload_hash(answers)
    if digest == sub.payload_hash:
        return present(db, sub)
    if payload.revision != sub.revision:
        raise ConflictException("Phiếu đã thay đổi ở phiên khác. Tải lại để tránh ghi đè.")
    changes = {"answers": answers, "payload_hash": digest, "classification": answers["classification"], "encounter_key": episode_key(answers["clinical_data"], uses_study_identity(sub, answers["clinical_data"]))}
    if is_admin_edit:
        changes.update(workflow_status="submitted", sync_status="syncing" if sub.sync_status == "syncing" else "pending", sync_error=None, sync_attempts=0)
    return write_change(db, sub, user, changes, "edit" if is_admin_edit else "save")


@router.post("/{key}/transition")
def transition(key: uuid.UUID, payload: Transition, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_user)):
    sub = accessible(db, key, user)
    if payload.action != "submit" and not physician(user):
        raise AppException(403, "FORBIDDEN", "Chỉ bác sĩ được duyệt, trả sửa, mở lại hoặc hủy phiếu.")
    targets = {"submit": "submitted", "approve": "approved", "return": "changes_requested", "reopen": "changes_requested", "cancel": "cancelled"}
    # A response lost after a successful transition can be replayed safely.
    if sub.workflow_status == targets[payload.action] and payload.revision == sub.revision - 1:
        return present(db, sub)
    if payload.revision != sub.revision:
        raise ConflictException("Phiếu đã thay đổi. Tải lại trước khi thao tác.")
    if payload.action in ("return", "reopen", "cancel") and not payload.note.strip():
        raise ValidationErrorException("Vui lòng ghi lý do hoặc yêu cầu bổ sung.")
    allowed = {"submit": {"draft", "changes_requested"}, "approve": {"submitted"}, "return": {"submitted"}, "reopen": {"approved"}, "cancel": STATES - {"cancelled"}}
    if sub.workflow_status not in allowed[payload.action]:
        raise ConflictException("Thao tác không phù hợp với trạng thái phiếu hiện tại.")
    changes = {"workflow_status": targets[payload.action], "review_note": payload.note.strip() or None}
    if payload.action in ("submit", "approve"):
        answers = checked_answers(sub, AnswersPayload.model_validate(sub.answers), final=True)
        changes.update(answers=answers, payload_hash=calculate_canonical_payload_hash(answers), classification=answers["classification"], encounter_key=episode_key(answers["clinical_data"], uses_study_identity(sub, answers["clinical_data"])))
    if payload.action == "submit":
        changes["submitted_at"] = datetime.now(timezone.utc)
    else:
        changes["reviewer_id"] = user.id
    if payload.action == "approve":
        changes["approved_at"] = datetime.now(timezone.utc)
    if payload.action == "cancel":
        changes["encounter_key"] = None
    if payload.action in ("submit", "approve", "cancel", "reopen"):
        changes.update(sync_status="syncing" if sub.sync_status == "syncing" else "pending", sync_error=None, sync_attempts=0)
    return write_change(db, sub, user, changes, payload.action, payload.note.strip() or None)


@router.get("/{key}/history")
def record_history(key: uuid.UUID, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_user)):
    sub = accessible(db, key, user, include_trash=True)
    events = db.scalars(select(SubmissionEvent).where(SubmissionEvent.submission_id == sub.id).order_by(SubmissionEvent.id.desc())).all()
    return [{"id": e.id, "action": e.action, "revision": e.revision, "note": e.note, "created_at": e.created_at,
             "actor": db.get(AdminUser, e.actor_id).username if e.actor_id and db.get(AdminUser, e.actor_id) else "Người nhập trực tiếp / hệ thống",
             "before_answers": e.before_answers, "after_answers": e.after_answers} for e in events]


@router.post("/{key}/retry-sync")
def retry_sync(key: uuid.UUID, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_admin)):
    sub = accessible(db, key, user, include_trash=True)
    if sub.sync_status == "syncing":
        raise ConflictException("Đồng bộ đang chạy. Vui lòng chờ.")
    if sub.workflow_status not in (*EXPORTABLE_STATES, "trashed") and sub.synced_revision is None and sub.sync_status not in ("failed", "pending"):
        raise ConflictException("Chỉ phiếu đã gửi hoặc đang cần gỡ khỏi Sheet mới cần đồng bộ.")
    sub.sync_status, sub.sync_attempts, sub.sync_error = "pending", 0, None
    db.commit()
    return present(db, sub)


@accounts_router.get("/me")
def me(user: AdminUser = Depends(AuthService.get_current_user)):
    return {"id": user.id, "username": user.username, "role": user.role}


class UserCreate(BaseModel):
    username: str = Field(min_length=3, max_length=64, pattern=r"^[a-zA-Z0-9_.-]+$")
    password: str = Field(min_length=12, max_length=64)
    role: Literal["intern", "doctor", "admin"] = "intern"


@accounts_router.get("")
def list_accounts(db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_admin)):
    return [{"id": u.id, "username": u.username, "role": u.role, "is_active": u.is_active} for u in db.scalars(select(AdminUser).order_by(AdminUser.username)).all()]


@accounts_router.post("", status_code=201)
def create_account(payload: UserCreate, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.require_account_admin)):
    if len(payload.password.encode("utf-8")) > 72:
        raise ValidationErrorException("Mật khẩu quá dài (tối đa 72 byte UTF-8).")
    account = AdminUser(username=payload.username, password_hash=hash_password(payload.password), role=payload.role)
    db.add(account)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ConflictException("Tên tài khoản đã tồn tại.")
    return {"id": account.id, "username": account.username, "role": account.role}


class AccountUpdate(BaseModel):
    is_active: bool | None = None
    password: str | None = Field(default=None, min_length=12, max_length=64)


@accounts_router.patch("/{account_id}")
def update_account(account_id: int, payload: AccountUpdate, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.require_account_admin)):
    account = db.get(AdminUser, account_id)
    if not account:
        raise NotFoundException("Không tìm thấy tài khoản.")
    if account.id == user.id and payload.is_active is False:
        raise ValidationErrorException("Không thể tự khóa tài khoản đang đăng nhập.")
    if payload.is_active is not None:
        account.is_active = payload.is_active
    if payload.password:
        if len(payload.password.encode()) > 72:
            raise ValidationErrorException("Mật khẩu tối đa 72 byte UTF-8.")
        account.password_hash = hash_password(payload.password)
    db.commit()
    return {"id": account.id, "username": account.username, "role": account.role, "is_active": account.is_active}
