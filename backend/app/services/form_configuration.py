"""One versioned clinical definition for entry, validation and exports."""
from copy import deepcopy
from sqlalchemy import select
from app.models.form_version import FormVersion
from app.schemas.form import ClinicalFieldSchema, FormSchemaDefinition
from app.services.clinical_validation import CONTRACT, NUMBERS, SURGERY_DETAILS
from app.core.exceptions import ValidationErrorException

FORM_KEY = "ovarian-pathology-who"
SECTIONS = {"sec1": "Hành chính", "sec2": "Tiền sử & lâm sàng", "sec3": "Dấu ấn sinh học", "sec4": "Siêu âm", "sec5": "Cộng hưởng từ", "sec6": "Phẫu thuật", "extra": "Thông tin bổ sung"}
SYSTEM_FIELDS = {"hospital_code", "hospital_cancer_center", "study_phase", "encounter_code", "treatment_date", "sa_iota_adnex", "missing_reasons"}
PROTECTED = {"so_hs", "para", "nam_sinh", "nam_kham", "tuoi_phau_thuat", *NUMBERS}


def baseline_fields():
    from app.services.export_svc import FORM_COLUMNS
    exported = {key for key, _ in FORM_COLUMNS}
    fields = []
    section = "sec1"
    starts = {"tuoi_phau_thuat": "sec2", "ca_125": "sec3", "sa_so_luong_u": "sec4", "mri_mo_buong_trung": "sec5", "pt_chan_doan_truoc": "sec6"}
    for key, label in CONTRACT["fields"].items():
        section = starts.get(key, section)
        if key in SYSTEM_FIELDS:
            continue
        multi = key in CONTRACT["multi_choices"]
        choices = CONTRACT["multi_choices"].get(key, CONTRACT["choices"].get(key, []))
        kind = "multiselect" if multi else "select" if choices else "number" if key in NUMBERS or key in ("nam_sinh", "nam_kham") else "text"
        if key == "sa_ket_luan" or key in SURGERY_DETAILS.values():
            kind = "textarea"
        active = key not in CONTRACT.get("retired_fields", []) and key != "mri_dich_nang"
        field = ClinicalFieldSchema(id=key, label=label, type=kind, section=section, required=key == "so_hs", active=active,
                                    export=key in exported or key in ("mri_dich_nang_t1w", "mri_dich_nang_t2w"), choices=[str(c) for c in choices],
                                    min_value=0 if kind == "number" else None,
                                    max_value=100 if key.startswith("iota_") or key == "roma" else 130 if key == "tuoi_phau_thuat" else None)
        if key.endswith("_ghi_chu"):
            field.show_when, field.show_values = key.removesuffix("_ghi_chu"), ["Có"]
        if key == "sa_nang_trong_phan_dac_so_luong":
            field.show_when, field.show_values = "sa_nang_trong_phan_dac", ["Có"]
        if key in ("ubt_xoan", "ubt_vo"):
            field.section = "sec6"
        fields.append(field)
    tissue_index = next(i for i, field in enumerate(fields) if field.id == "mri_mo_buong_trung")
    count_index = next(i for i, field in enumerate(fields) if field.id == "mri_so_luong_u")
    fields[tissue_index], fields[count_index] = fields[count_index], fields[tissue_index]
    moved = {"ubt_xoan", "ubt_vo"}
    return [f for f in fields if f.id not in moved] + [f for f in fields if f.id in moved]


def effective_schema(raw):
    schema = FormSchemaDefinition.model_validate(raw)
    if schema.clinical_fields is None:
        schema.clinical_fields = baseline_fields()
    return schema


def all_versions(db):
    return db.scalars(select(FormVersion).where(FormVersion.form_key == FORM_KEY, FormVersion.status == "published").order_by(FormVersion.version)).all()


def validate_configuration(schema, previous, history):
    errors = []
    if schema.form_key != FORM_KEY or not schema.title.strip() or len(schema.title) > 200:
        errors.append("Tên hoặc mã biểu mẫu không hợp lệ.")
    fields = schema.clinical_fields
    if not fields:
        raise ValidationErrorException("Biểu mẫu cần có danh sách câu hỏi lâm sàng.")
    ids = [f.id for f in fields]
    if len(set(ids)) != len(ids) or any(k in SYSTEM_FIELDS or k in {"submission_uuid", "created_at", "who_diagnosis", "who_diagnosis_1", "who_diagnosis_2", "who_icdo_code", "classification", "pathology", "study_code", "workflow_status", "owner_name", "reviewer_name", "approved_at", "constructor", "prototype"} for k in ids):
        errors.append("Mã câu hỏi bị trùng hoặc trùng với trường hệ thống.")
    old = {f.id: f for f in effective_schema(previous).clinical_fields}
    current = {f.id: f for f in fields}
    if set(old) - set(current):
        errors.append("Không xóa mã câu hỏi đã có. Hãy chọn Ngừng dùng để giữ dữ liệu lịch sử.")
    # A header ever used by one key cannot be reassigned to another key.
    from app.services.export_svc import FORM_COLUMNS
    historical_labels = {label.casefold(): key for key, label in FORM_COLUMNS}
    historical_labels["mã nghiên cứu"] = "study_code"
    historical_labels["phân loại giải phẫu bệnh theo who"] = "who_diagnosis_1"
    for version in history:
        for field in effective_schema(version.schema_json).clinical_fields:
            historical_labels[field.label.strip().casefold()] = field.id
    labels = set()
    for field in fields:
        field.label = field.label.strip()
        label = field.label.casefold()
        if not label or field.label.startswith(("=", "+", "-", "@")) or label in labels or (label in historical_labels and historical_labels[label] != field.id):
            errors.append(f"{field.id}: tên câu hỏi trống, trùng hoặc từng thuộc câu hỏi khác.")
        labels.add(label)
        if field.id == "so_hs" and field.type != "text":
            errors.append("Số hồ sơ phải dùng văn bản ngắn để giữ nguyên mã và số 0 ở đầu.")
        if field.id == "so_hs" and (not field.active or not field.required or not field.export):
            errors.append("Số hồ sơ phải được bật, bắt buộc và có trong dữ liệu xuất.")
        if field.id in PROTECTED and field.id in old:
            baseline = old[field.id]
            if field.min_value != baseline.min_value or field.max_value != baseline.max_value:
                errors.append(f"{field.label}: giữ nguyên giới hạn kiểm tra chuyên môn của trường hệ thống.")
        if field.type in ("select", "multiselect"):
            if not field.choices or len(field.choices) != len(set(field.choices)) or any(not c.strip() or len(c) > 200 or c != c.strip() for c in field.choices):
                errors.append(f"{field.label}: cần các lựa chọn khác nhau, không trống, tối đa 200 ký tự.")
        elif field.choices:
            errors.append(f"{field.label}: chỉ câu hỏi lựa chọn mới có danh sách lựa chọn.")
        if field.min_value is not None and field.max_value is not None and field.min_value > field.max_value:
            errors.append(f"{field.label}: giá trị nhỏ nhất lớn hơn giá trị lớn nhất.")
        if field.show_when:
            parent = current.get(field.show_when)
            old_field, old_parent = old.get(field.id), old.get(field.show_when)
            # Preserve older published conditions whose trigger was already retired.
            legacy_values = (set(old_field.show_values) - set(old_parent.choices)
                             if old_field and old_parent and old_field.show_when == field.show_when else set())
            if (not parent or parent.id == field.id or parent.show_when
                    or parent.type not in ("select", "multiselect") or not field.show_values
                    or len(field.show_values) != len(set(field.show_values))
                    or field.active and any(value not in parent.choices and value not in legacy_values for value in field.show_values)
                    or field.active and not parent.active):
                errors.append(f"{field.label}: điều kiện hiển thị không hợp lệ (chỉ hỗ trợ một cấp).")
        elif field.show_values:
            errors.append(f"{field.label}: cần chọn câu hỏi làm điều kiện hiển thị.")
        if field.id == "so_hs" and field.show_when:
            errors.append("Số hồ sơ phải luôn hiển thị.")
    pathology = next((f for f in schema.fields if f.id == "pathology"), None)
    iota_flags = {field.active for field in fields if field.id.startswith("iota_")}
    if len(iota_flags) > 1:
        errors.append("Bật hoặc ngừng dùng đồng thời cả 6 câu hỏi IOTA để giữ quy tắc tổng tỷ lệ.")
    if not pathology or not pathology.options or not pathology.required:
        errors.append("Giữ danh mục và yêu cầu chọn kết quả giải phẫu bệnh WHO.")
    elif len({o.id for o in pathology.options}) != len(pathology.options) or any(not o.id.strip() or not o.label.strip() or o.children or o.classification not in ("benign", "borderline", "malignant", "unspecified") for o in pathology.options):
        errors.append("Danh mục WHO cần mã khác nhau, tên và phân loại hợp lệ; không dùng lựa chọn lồng nhau.")
    if errors:
        raise ValidationErrorException("Chưa thể xuất bản cấu hình biểu mẫu.", errors)


def export_definitions(db):
    """Latest names/settings and all historical aliases, joined by immutable field id."""
    from app.services.export_svc import FORM_COLUMNS
    versions = all_versions(db)
    result = {key: {"key": key, "label": label, "aliases": [label], "export": True, "type": "number" if key in NUMBERS or key in ("nam_sinh", "nam_kham", "hospital_cancer_center") else "text"} for key, label in FORM_COLUMNS}
    result["submission_uuid"]["hidden"] = True
    result["study_code"]["aliases"].append("Mã nghiên cứu")
    result["who_diagnosis_1"]["aliases"].append("Phân loại Giải phẫu bệnh theo WHO")
    # Legacy records also collect these fields before a managed form is
    # published. Recognize their columns instead of failing every row update.
    for field in baseline_fields():
        if field.export and field.id not in result:
            result[field.id] = {"key": field.id, "label": field.label,
                                "aliases": [field.label], "export": True, "type": field.type}
    managed = False
    latest_fields = []
    for version in versions:
        schema = FormSchemaDefinition.model_validate(version.schema_json)
        if schema.clinical_fields is None:
            continue
        managed = True
        latest_fields = schema.clinical_fields
        for field in schema.clinical_fields:
            item = result.setdefault(field.id, {"key": field.id, "label": field.label, "aliases": [], "export": field.export})
            if field.label not in item["aliases"]:
                item["aliases"].append(field.label)
            item.update(label=field.label, export=field.export, type=field.type)
    if managed:
        return organize_export_definitions(list(result.values()), latest_fields), True
    return list(result.values()), False


def organize_export_definitions(definitions, fields):
    """Keep identifiers first and clinical columns beside their form section."""
    by_key = {item["key"]: item for item in definitions}
    clinical = {field.id: field for field in fields}
    first = ["submission_uuid", "study_code", "created_at", "so_hs", "ho_ten", "hospital_code", "study_phase"]
    who = ["who_diagnosis_1", "who_diagnosis_2", "who_icdo_code", "classification"]
    hidden = {"submission_uuid", "encounter_code", "hospital_cancer_center", "mri_dich_nang"}
    ordered = []
    used = set()

    def add(key, section):
        if key in used or key not in by_key:
            return
        item = {**by_key[key], "section": section}
        if key in hidden:
            item["hidden"] = True
        ordered.append(item)
        used.add(key)

    for key in first:
        add(key, "identity")
    for section in SECTIONS:
        for field in fields:
            if field.section == section:
                add(field.id, section)
    for key in who:
        add(key, "who")
    for item in definitions:
        key = item["key"]
        # A code update must not silently enable new clinical columns absent
        # from the published managed schema. Keep aliases for safe migration.
        if key in CONTRACT["fields"] and key not in clinical and key not in SYSTEM_FIELDS:
            item["export"] = False
        add(key, "system")
    return ordered


def clinical_contract_for(schema):
    contract = deepcopy(CONTRACT)
    fields = schema.clinical_fields or []
    for field in fields:
        contract["fields"][field.id] = field.label
        contract["choices"].pop(field.id, None)
        contract["multi_choices"].pop(field.id, None)
        if field.type == "select":
            contract["choices"][field.id] = field.choices
        if field.type == "multiselect":
            contract["multi_choices"][field.id] = field.choices
    # This legacy aggregate is derived from T1W/T2W, never entered directly.
    contract["retired_fields"] = [f.id for f in fields if not f.active and f.id != "mri_dich_nang"]
    return contract


def matches_field_condition(field, data):
    if not field.show_when:
        return True
    value = data.get(field.show_when)
    values = value if isinstance(value, list) else [value]
    return any(str(item) in field.show_values for item in values)
