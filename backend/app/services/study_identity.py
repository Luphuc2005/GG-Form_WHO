"""Allocate study codes inside the same transaction that submits a record."""
from copy import deepcopy
from app.models.study_sequence import StudySequence
from app.core.exceptions import ValidationErrorException
from app.core.security import calculate_canonical_payload_hash

HOSPITALS = {
    "TD": "Bệnh viện Từ Dũ",
    "HV": "Bệnh viện Hùng Vương",
    "YD": "Bệnh viện Đại học Y Dược TP.HCM",
    "GD": "Bệnh viện Nhân Dân Gia Định",
    "UB": "Bệnh viện Ung Bướu (Cơ sở 2)",
}
PHASES = {"R": "Hồi cứu (2021–2026)", "P": "Tiến cứu (2027–2029)"}


def uses_study_identity(sub, data):
    return sub.identity_version >= 2 or bool(data.get("study_phase"))


def validate_identity(sub, data, final=False):
    hospital, phase = data.get("hospital_code", ""), data.get("study_phase", "")
    errors = []
    if hospital and hospital not in HOSPITALS:
        errors.append("Chọn bệnh viện trong danh sách TD, HV, YD, GD, UB.")
    if phase and phase not in PHASES:
        errors.append("Giai đoạn nghiên cứu phải là R (Hồi cứu) hoặc P (Tiến cứu).")
    if final and (not hospital or not phase):
        errors.append("Cần chọn bệnh viện và giai đoạn nghiên cứu trước khi gửi phiếu.")
    original = (sub.answers or {}).get("clinical_data") or {}
    if sub.study_code and any(data.get(key) != original.get(key) for key in ("hospital_code", "study_phase")):
        errors.append("Phiếu đã được cấp mã nghiên cứu; không thể đổi bệnh viện hoặc giai đoạn.")
    if errors:
        raise ValidationErrorException("Vui lòng kiểm tra thông tin mã nghiên cứu.", errors)


def assign_study_code(db, sub, changes):
    """Atomic counter per hospital/phase. No yearly reset or reuse after cancellation."""
    answers = changes.get("answers") or sub.answers
    data = answers.get("clinical_data") or {}
    if not uses_study_identity(sub, data):
        return
    changes["identity_version"] = 2
    if sub.study_code or changes.get("workflow_status") != "submitted":
        return
    validate_identity(sub, data, final=True)
    dialect = db.get_bind().dialect.name
    if dialect == "sqlite":
        from sqlalchemy.dialects.sqlite import insert
    elif dialect == "postgresql":
        from sqlalchemy.dialects.postgresql import insert
    else:
        raise RuntimeError("Unsupported study-code counter database")
    statement = insert(StudySequence).values(hospital_code=data["hospital_code"], phase=data["study_phase"], last_value=1)
    statement = statement.on_conflict_do_update(
        index_elements=[StudySequence.hospital_code, StudySequence.phase],
        set_={"last_value": StudySequence.last_value + 1},
    ).returning(StudySequence.last_value)
    number = db.scalar(statement)
    if number > 99999:
        raise ValidationErrorException("Dãy mã nghiên cứu của bệnh viện/giai đoạn này đã đủ 99999 phiếu.")
    code = f"{data['hospital_code']}_{data['study_phase']}_{number:05d}"
    answers = deepcopy(answers)
    answers["clinical_data"]["encounter_code"] = code
    changes.update(study_code=code, study_number=number, answers=answers,
                   payload_hash=calculate_canonical_payload_hash(answers))
