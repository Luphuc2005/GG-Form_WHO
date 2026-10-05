from app.services.export_svc import infer_classification
import uuid
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session
from app.core.exceptions import ConflictException, NotFoundException, ValidationErrorException
from app.core.security import calculate_canonical_payload_hash
from app.models.submission import Submission
from app.models.form_version import FormVersion
from app.repositories.form_repo import FormRepository
from app.repositories.submission_repo import SubmissionRepository
from app.schemas.form import FormSchemaDefinition
from app.schemas.submission import SubmissionCreateRequest, SubmissionResponse
from app.services.validator import validate_submission_against_schema


class SubmissionService:
    @staticmethod
    def create_submission(db: Session, request: SubmissionCreateRequest) -> SubmissionResponse:
        # 1. Resolve published form version
        form_ver = FormRepository.get_by_key_and_version(
            db, form_key="ovarian-pathology-who", version=request.form_version
        )
        if not form_ver or form_ver.status != "published":
            raise NotFoundException(
                f"Phiên bản biểu mẫu {request.form_version} không tồn tại hoặc chưa được công bố."
            )

        # 2. Canonical payload hash for idempotency check
        payload_hash = calculate_canonical_payload_hash(request.answers)

        # Check existing first before validation (to handle fast retries gracefully)
        existing = SubmissionRepository.get_by_uuid(db, request.submission_uuid)
        if existing:
            if existing.payload_hash == payload_hash:
                ref_code = str(existing.submission_uuid).split("-")[0].upper()
                return SubmissionResponse(
                    submission_uuid=existing.submission_uuid,
                    reference_code=ref_code,
                    form_version=form_ver.version,
                    status="success",
                    created_at=existing.created_at,
                    message="Phiếu đã được ghi nhận trước đó (Idempotent replay)."
                )
            else:
                raise ConflictException(
                    "Mã phiếu (UUID) đã tồn tại với nội dung dữ liệu khác."
                )

        # 3. Validate answers against form schema
        schema_def = FormSchemaDefinition.model_validate(form_ver.schema_json)
        validate_submission_against_schema(schema_def, request.answers)

        # 4. Insert submission with transaction
        new_sub = Submission(
            submission_uuid=request.submission_uuid,
            form_version_id=form_ver.id,
            payload_hash=payload_hash,
            classification=infer_classification(request.answers.pathology.model_dump() if hasattr(request.answers.pathology, "model_dump") else (request.answers.pathology or {}), request.answers.classification),
            answers=request.answers.model_dump(mode="json"),
        )

        try:
            db.add(new_sub)
            db.commit()
            db.refresh(new_sub)

            # Trigger real-time sync to Google Sheets (if webhook configured)
            from app.services.google_sheets_svc import trigger_google_sheets_sync
            trigger_google_sheets_sync(new_sub.id)
        except IntegrityError:
            db.rollback()
            # Race condition handling: check if another concurrent worker inserted this UUID
            existing = SubmissionRepository.get_by_uuid(db, request.submission_uuid)
            if existing:
                if existing.payload_hash == payload_hash:
                    ref_code = str(existing.submission_uuid).split("-")[0].upper()
                    return SubmissionResponse(
                        submission_uuid=existing.submission_uuid,
                        reference_code=ref_code,
                        form_version=form_ver.version,
                        status="success",
                        created_at=existing.created_at,
                        message="Phiếu đã được ghi nhận thành công."
                    )
                else:
                    raise ConflictException("Mã phiếu (UUID) đã tồn tại với nội dung dữ liệu khác.")
            raise

        ref_code = str(new_sub.submission_uuid).split("-")[0].upper()
        return SubmissionResponse(
            submission_uuid=new_sub.submission_uuid,
            reference_code=ref_code,
            form_version=form_ver.version,
            status="success",
            created_at=new_sub.created_at,
            message="Gửi phiếu thành công."
        )
