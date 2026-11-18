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
    def create_submission(db: Session, request: SubmissionCreateRequest, actor=None) -> SubmissionResponse:
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
        from app.services.record_data import episode_key
        from app.models.submission_event import SubmissionEvent
        selected = request.answers.pathology.selected
        from app.services.pathology_results import results_by_slot
        primary = results_by_slot(selected).get(1)
        if primary:
            option = next((o for f in schema_def.fields if f.id == "pathology" for o in f.options if o.id == primary.id), None)
            if option and option.classification and option.classification != request.answers.classification:
                raise ValidationErrorException("Phân loại không khớp với kết quả GPB đã chọn.")

        # 4. Insert submission with transaction
        new_sub = Submission(
            submission_uuid=request.submission_uuid,
            form_version_id=form_ver.id,
            payload_hash=payload_hash,
            classification=infer_classification(request.answers.pathology.model_dump() if hasattr(request.answers.pathology, "model_dump") else (request.answers.pathology or {}), request.answers.classification),
            answers=request.answers.model_dump(mode="json"),
            owner_id=actor.id if actor else None,
            sync_status="pending",
            encounter_key=episode_key(request.answers.clinical_data or {}),
        )

        try:
            db.add(new_sub)
            db.flush()
            db.add(SubmissionEvent(submission_id=new_sub.id, actor_id=actor.id if actor else None, action="submit", revision=1, after_answers=new_sub.answers))
            db.commit()
            db.refresh(new_sub)

            # Trigger real-time sync to Google Sheets (if webhook configured)
            # Sent records are queued immediately; no physician approval gate.
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
            raise ConflictException("Đợt điều trị này đã có phiếu; vui lòng mở phiếu hiện có.")

        ref_code = str(new_sub.submission_uuid).split("-")[0].upper()
        return SubmissionResponse(
            submission_uuid=new_sub.submission_uuid,
            reference_code=ref_code,
            form_version=form_ver.version,
            status="success",
            created_at=new_sub.created_at,
            message="Gửi phiếu thành công."
        )
