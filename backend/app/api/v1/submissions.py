import uuid
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session
from app.core.exceptions import NotFoundException
from app.database import get_db
from app.repositories.submission_repo import SubmissionRepository
from app.schemas.submission import (
    SubmissionCreateRequest,
    SubmissionResponse,
    SubmissionStatusResponse,
)
from app.services.submission_svc import SubmissionService
from app.models.admin_user import AdminUser
from app.services.auth_svc import AuthService

router = APIRouter(prefix="/submissions", tags=["Submissions"])


@router.post("", response_model=SubmissionResponse, status_code=status.HTTP_201_CREATED)
def submit_survey(
    payload: SubmissionCreateRequest,
    db: Session = Depends(get_db),
    user: AdminUser = Depends(AuthService.get_current_admin),
):
    """
    Submit survey answers.
    Idempotent operation: retrying with the same submission_uuid and payload
    returns the existing successful record without duplicating.
    """
    from app.services.clinical_validation import validate_clinical
    from app.repositories.form_repo import FormRepository
    from app.schemas.form import FormSchemaDefinition
    version = FormRepository.get_by_key_and_version(db, "ovarian-pathology-who", payload.form_version)
    schema = FormSchemaDefinition.model_validate(version.schema_json) if version else None
    validate_clinical(payload.answers.clinical_data or {}, final=True, schema=schema)
    return SubmissionService.create_submission(db, payload, actor=user)


@router.get("/{submission_uuid}/status", response_model=SubmissionStatusResponse)
def get_submission_status(
    submission_uuid: uuid.UUID,
    db: Session = Depends(get_db),
    user: AdminUser = Depends(AuthService.get_current_admin),
):
    """Check submission status by its UUID."""
    sub = SubmissionRepository.get_by_uuid(db, submission_uuid)
    if not sub:
        raise NotFoundException("Không tìm thấy phiếu khảo sát với UUID tương ứng.")
    return SubmissionStatusResponse(
        submission_uuid=sub.submission_uuid,
        status="completed",
        created_at=sub.created_at,
    )
