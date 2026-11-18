import hashlib
import unicodedata
from app.schemas.form import FormSchemaDefinition
from app.services.validator import FormSchemaValidator
from app.services.clinical_validation import validate_clinical
from app.core.exceptions import ValidationErrorException
from app.services.study_identity import uses_study_identity, validate_identity
from app.services.pathology_results import results_by_slot


def episode_key(data, study_identity=False):
    fields = ("hospital_code", "so_hs", "treatment_date") if study_identity else ("hospital_code", "so_hs", "encounter_code")
    parts = [unicodedata.normalize("NFKC", str(data.get(k) or "")).strip().upper() for k in fields]
    if not all(parts):
        return None
    import json
    return hashlib.sha256(json.dumps(parts, ensure_ascii=False).encode()).hexdigest()


def checked_answers(sub, answers, final=False):
    if answers.model_extra:
        raise ValidationErrorException("Dữ liệu chứa trường ngoài cấu trúc phiếu.")
    clinical = answers.clinical_data or {}
    study = uses_study_identity(sub, clinical)
    if study:
        validate_identity(sub, clinical, final)
        clinical = {**clinical, "encounter_code": sub.study_code or "",
                    "hospital_cancer_center": (1 if clinical.get("hospital_code") == "UB" else 0) if clinical.get("hospital_code") else ""}
    schema = FormSchemaDefinition.model_validate(sub.form_version.schema_json)
    validate_clinical(clinical, final, study_identity=study, previous_data=(sub.answers or {}).get("clinical_data") or {}, schema=schema)
    validator = FormSchemaValidator(schema)
    pathology = next((f for f in schema.fields if f.id == "pathology"), None)
    selected = answers.pathology.selected if answers.pathology else []
    slots = results_by_slot(selected)
    if final:
        if not pathology:
            raise ValidationErrorException("Phiên bản biểu mẫu thiếu danh mục GPB.")
        if not answers.pathology:
            raise ValidationErrorException("Vui lòng chọn kết quả GPB.")
        validator._validate_pathology(pathology, answers.pathology)
    elif selected and (not pathology or any(not any(o.id == node.id for o in pathology.options) or node.children for node in selected)):
        raise ValidationErrorException("Lựa chọn GPB không thuộc phiên bản biểu mẫu này.")
    classification = "unspecified"
    if slots.get(1) and pathology:
        option = next((o for o in pathology.options if o.id == slots[1].id), None)
        classification = (option.classification if option else None) or "unspecified"
    # Always derive the classification from the pinned form, never trust the client.
    result = answers.model_dump(mode="json")
    if result.get("pathology") is not None:
        result["pathology"]["selected"] = [{**node.model_dump(mode="json"), "slot": slot} for slot, node in sorted(slots.items())]
    result["clinical_data"] = clinical
    result["classification"] = classification
    return result
