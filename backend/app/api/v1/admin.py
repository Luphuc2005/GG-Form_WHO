import hashlib
import json
from datetime import datetime, timezone
from typing import Optional
from urllib.parse import quote
from fastapi import APIRouter, Depends, Query, Response, status
from fastapi.responses import StreamingResponse
from sqlalchemy import select, update, or_, case
from sqlalchemy.orm import Session
from app.config import get_settings
from app.core.exceptions import AppException, NotFoundException
from app.database import get_db
from app.models.admin_user import AdminUser
from app.models.submission import Submission, EXPORTABLE_STATES
from app.models.form_version import FormVersion
from app.repositories.submission_repo import SubmissionRepository
from app.schemas.admin import (
    AdminLoginRequest,
    AdminStatsResponse,
    AdminSubmissionsPageResponse,
    AdminSubmissionListItem,
    AdminTokenResponse,
)
from app.schemas.submission import SubmissionDetailResponse
from app.schemas.form import FormSchemaDefinition, FormVersionResponse
from app.services.auth_svc import AuthService
from app.services.export_svc import ExportService

settings = get_settings()
router = APIRouter(prefix="/admin", tags=["Admin"])


@router.post("/login", response_model=AdminTokenResponse)
def admin_login(
    payload: AdminLoginRequest,
    response: Response,
    db: Session = Depends(get_db)
):
    """Authenticate admin and return JWT token and HttpOnly cookie."""
    user = AuthService.authenticate_admin(db, payload.username, payload.password)
    token = AuthService.create_token_for_user(user)

    # Set secure HttpOnly cookie
    is_prod = settings.APP_ENV == "production"
    response.set_cookie(
        key=settings.ADMIN_COOKIE_NAME,
        value=token,
        httponly=True,
        secure=is_prod,
        samesite="lax",
        max_age=settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60,
    )

    return AdminTokenResponse(access_token=token, username=user.username)


@router.post("/logout")
def admin_logout(response: Response):
    """Clear admin session cookie."""
    response.delete_cookie(key=settings.ADMIN_COOKIE_NAME)
    return {"message": "Đăng xuất thành công"}


@router.get("/statistics", response_model=AdminStatsResponse)
def get_statistics(
    db: Session = Depends(get_db),
    _: AdminUser = Depends(AuthService.get_current_admin)
):
    """Get high-level survey statistics."""
    stats = SubmissionRepository.get_stats(db)
    spreadsheet_id = (settings.GOOGLE_SHEETS_SPREADSHEET_ID or "").strip()
    if spreadsheet_id:
        stats["google_sheet_url"] = f"https://docs.google.com/spreadsheets/d/{quote(spreadsheet_id, safe='')}/edit#gid=0"
    return AdminStatsResponse(**stats)


@router.get("/submissions", response_model=AdminSubmissionsPageResponse)
def list_submissions(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    form_version: Optional[int] = Query(None),
    classification: Optional[str] = Query(None),
    date_from: Optional[datetime] = Query(None),
    date_to: Optional[datetime] = Query(None),
    q: str = Query("", max_length=200),
    db: Session = Depends(get_db),
    _: AdminUser = Depends(AuthService.get_current_admin)
):
    """Get paginated list of survey submissions."""
    skip = (page - 1) * page_size
    items, total = SubmissionRepository.get_paginated(
        db,
        skip=skip,
        limit=page_size,
        form_version=form_version,
        classification=classification,
        date_from=date_from,
        date_to=date_to,
        q=q,
    )

    result_items = []
    for item in items:
        ref_code = str(item.submission_uuid).split("-")[0].upper()
        ver_num = item.form_version.version if item.form_version else 1
        answers = item.answers if isinstance(item.answers, dict) else {}
        clinical = answers.get("clinical_data", {}) if isinstance(answers, dict) else {}
        result_items.append(
            AdminSubmissionListItem(
                id=item.id,
                submission_uuid=item.submission_uuid,
                reference_code=ref_code,
                form_version=ver_num,
                classification=item.classification,
                created_at=item.created_at,
                so_hs=str(clinical.get("so_hs") or "").strip() or None,
                ho_ten=str(clinical.get("ho_ten") or "").strip() or None,
                nam_sinh=str(clinical.get("nam_sinh") or "").strip() or None,
                tuoi=str(clinical.get("tuoi_phau_thuat") or "").strip() or None,
            )
        )

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    return AdminSubmissionsPageResponse(
        items=result_items,
        total=total,
        page=page,
        page_size=page_size,
        total_pages=total_pages,
    )


@router.get("/submissions/{sub_id}", response_model=SubmissionDetailResponse)
def get_submission_detail(
    sub_id: int,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(AuthService.get_current_admin)
):
    """Get complete raw submission detail by ID."""
    stmt = select(Submission).where(Submission.id == sub_id)
    sub = db.scalars(stmt).first()
    if not sub:
        raise NotFoundException(f"Không tìm thấy phiếu #{sub_id}.")

    ver_num = sub.form_version.version if sub.form_version else 1
    return SubmissionDetailResponse(
        id=sub.id,
        submission_uuid=sub.submission_uuid,
        form_version=ver_num,
        classification=sub.classification,
        answers=sub.answers,
        created_at=sub.created_at,
    )


@router.get("/export.csv")
def export_csv(
    form_version: Optional[int] = Query(None),
    db: Session = Depends(get_db),
    _: AdminUser = Depends(AuthService.get_current_admin)
):
    """
    Stream wide-format CSV with UTF-8 BOM.
    Processes in batches using DB cursor to prevent loading all rows into RAM.
    """
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    filename = f"ovarian_submissions_{timestamp}.csv"

    return StreamingResponse(
        ExportService.stream_csv(db, form_version_num=form_version),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Pragma": "no-cache",
            "Expires": "0",
        }
    )


@router.delete("/submissions/{sub_id}", status_code=status.HTTP_200_OK)
def delete_submission(
    sub_id: int,
    reason: str = Query(..., min_length=3, max_length=2000),
    db: Session = Depends(get_db),
    user: AdminUser = Depends(AuthService.get_current_admin)
):
    """Delete a single submission (Admin only)."""
    stmt = select(Submission).where(Submission.id == sub_id)
    sub = db.scalars(stmt).first()
    if not sub:
        raise NotFoundException(f"Không tìm thấy phiếu #{sub_id}.")

    from app.api.v1.records import transition, Transition
    transition(sub.submission_uuid, Transition(revision=sub.revision, action="cancel", note=reason), db, user)
    return {"message": f"Đã hủy phiếu #{sub_id}; dữ liệu và lịch sử vẫn được giữ lại."}


@router.get("/export.xlsx")
def export_xlsx(db: Session = Depends(get_db), _: AdminUser = Depends(AuthService.get_current_admin)):
    output = ExportService.xlsx_file(db)
    def chunks():
        try:
            while data := output.read(65536):
                yield data
        finally:
            output.close()
    return StreamingResponse(chunks(), media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="ovarian_submissions_{datetime.now():%Y%m%d_%H%M%S}.xlsx"', "Cache-Control":"no-store"})


@router.post("/google-sheets/resync")
def resync_google_sheets(
    db: Session = Depends(get_db),
    _: AdminUser = Depends(AuthService.get_current_admin)
):
    """Queue writes and report destination rows that the record queue cannot remove."""
    from app.services import google_sheets_svc as sheets
    from app.services.record_sync import sync_error_message
    warning = None
    extra_count = None
    if sheets.settings.GOOGLE_SHEETS_SPREADSHEET_ID:
        try:
            _, remote = sheets._read_sheet_snapshot()
            local_keys = {str(key) for key in db.scalars(select(Submission.submission_uuid))}
            extra_count = sum(count for key, count in remote.items() if key not in local_keys)
            if extra_count:
                warning = (
                    f"Sheet còn {extra_count} dòng phiếu không còn trong hệ thống. "
                    "Các dòng này chưa được xóa. Nút đồng bộ chỉ gửi các phiếu hiện có; "
                    "hãy xóa các dòng cũ trên Sheet bằng tài khoản có quyền chỉnh sửa."
                )
        except Exception as error:
            warning = "Chưa đối chiếu được dữ liệu cũ trên Sheet. " + sync_error_message(error)
    else:
        warning = "Chưa cấu hình Sheet đích để đối chiếu. Phiếu trong hệ thống vẫn được giữ lại."
    result = db.execute(update(Submission).where(or_(
        Submission.workflow_status.in_(EXPORTABLE_STATES),
        (Submission.synced_revision.is_not(None)) & (Submission.workflow_status.in_(("changes_requested", "cancelled"))),
    )).values(sync_status=case((Submission.sync_status == "syncing", "syncing"), else_="pending"), sync_error=None, sync_attempts=0))
    db.commit()
    response = {"status": "queued", "count": result.rowcount}
    if warning:
        response.update(warning=warning, sheet_extra_count=extra_count)
    return response


@router.post("/forms/publish", response_model=FormVersionResponse)
def publish_form(
    payload: FormSchemaDefinition,
    db: Session = Depends(get_db),
    _: AdminUser = Depends(AuthService.require_form_admin)
):
    """Publish a new form schema version from develop mode."""
    from app.repositories.form_repo import FormRepository
    current = FormRepository.get_published_by_key(db, payload.form_key)
    if current and (current.schema_json.get("clinical_fields") is not None or payload.clinical_fields is not None):
        # The legacy WHO editor must preserve the clinical snapshot and use the
        # same publication queue and concurrency checks as the form manager.
        from app.api.v1.form_builder import ConfigurationChange, publish_configuration
        from app.models.form_management import FormDraft
        from app.core.exceptions import ConflictException
        if db.get(FormDraft, payload.form_key):
            raise ConflictException("Đang có bản nháp trong Quản lý biểu mẫu. Mở mục đó để đối chiếu và xuất bản.")
        if payload.clinical_fields is None:
            payload.clinical_fields = FormSchemaDefinition.model_validate(current.schema_json).clinical_fields
        return_form = publish_configuration(ConfigurationChange(base_version=payload.version, schema=payload,
            draft_revision=0), db, _)
        return FormRepository.get_by_key_and_version(db, payload.form_key, return_form["version"])
    stmt = (
        select(FormVersion)
        .where(FormVersion.form_key == payload.form_key)
        .order_by(FormVersion.version.desc())
        .limit(1)
    )
    latest = db.scalars(stmt).first()
    new_version = (latest.version + 1) if latest else 1

    schema_dict = payload.model_dump()
    schema_dict["version"] = new_version

    canonical_json = json.dumps(schema_dict, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    schema_hash = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    new_form_ver = FormVersion(
        form_key=payload.form_key,
        version=new_version,
        status="published",
        schema_json=schema_dict,
        schema_hash=schema_hash,
        published_at=datetime.now(timezone.utc),
    )
    db.add(new_form_ver)
    db.commit()
    db.refresh(new_form_ver)
    return new_form_ver

