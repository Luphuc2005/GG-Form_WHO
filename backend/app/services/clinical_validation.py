"""Validation for data transcription; never invent or auto-correct clinical results."""
from datetime import date
from decimal import Decimal, InvalidOperation
import json
from pathlib import Path
from app.core.exceptions import ValidationErrorException

CONTRACT = json.loads(Path(__file__).with_name("clinical_contract.json").read_text(encoding="utf-8"))

MISSING = {"not_done", "not_documented", "not_applicable"}
NUMBERS = {
    "ca_125", "he4", "roma", "afp", "beta_hcg", "tuoi_phau_thuat",
    "sa_kich_thuoc_u", "sa_kich_thuoc_phan_dac",
    "mri_kich_thuoc_u", "mri_kich_thuoc_phan_dac",
    "iota_benign", "iota_malignant", "iota_borderline", "iota_stage1", "iota_stage2_4", "iota_metastatic", "sa_iota_adnex",
}
IOTA = ("iota_benign", "iota_malignant", "iota_borderline", "iota_stage1", "iota_stage2_4", "iota_metastatic")
SURGERY_DETAILS = {
    "pt_co_dich_o_bung": "pt_co_dich_o_bung_ghi_chu",
    "pt_u_dinh_co_quan_khac": "pt_u_dinh_co_quan_khac_ghi_chu",
    "pt_nghi_ngo_di_can": "pt_nghi_ngo_di_can_ghi_chu",
}
SURGERY_FIELDS = ("pt_so_luong_u", *(key for pair in SURGERY_DETAILS.items() for key in pair))


def validate_clinical(data: dict, final: bool = False, study_identity: bool = False, previous_data: dict | None = None, schema=None):
    contract = CONTRACT
    if schema is not None and schema.clinical_fields is not None:
        from app.services.form_configuration import clinical_contract_for
        contract = clinical_contract_for(schema)
    multi_fields = set(contract["multi_choices"])
    errors = []
    previous_data = previous_data or {}
    missing = data.get("missing_reasons", {})
    if not isinstance(missing, dict) or any(not isinstance(v, str) or v not in MISSING for v in missing.values()):
        raise ValidationErrorException("Lý do thiếu dữ liệu không hợp lệ.")
    if any(k not in contract["fields"] for k in missing):
        errors.append("Lý do thiếu dữ liệu chứa trường không tồn tại")
    for key, value in data.items():
        if key == "missing_reasons":
            continue
        if key not in contract["fields"]:
            errors.append(f"{key}: trường không có trong biểu mẫu")
        if not isinstance(value, (str, int, float, list)) or isinstance(value, bool):
            errors.append(f"{key}: kiểu dữ liệu không hợp lệ")
        elif len(str(value)) > 4000:
            errors.append(f"{key}: tối đa 4000 ký tự")
        if key in missing and value not in ("", None, []):
            errors.append(f"{key}: đã có giá trị thì không đánh dấu thiếu dữ liệu")
        legacy_unchanged = value == previous_data.get(key) and value in contract.get("legacy_choices", {}).get(key, [])
        if key in contract["choices"] and value not in ("", None) and value not in contract["choices"][key] and not legacy_unchanged:
            errors.append(f"{key}: lựa chọn không hợp lệ")
        if key in contract.get("retired_fields", []) and value not in ("", None, []) and value != previous_data.get(key):
            errors.append(f"{key}: mục này đã bỏ khỏi biểu mẫu, chỉ giữ lại dữ liệu cũ đã lưu")
        if key not in multi_fields and isinstance(value, list):
            errors.append(f"{key}: không nhận danh sách")
    for key in multi_fields:
        if key in data and (not isinstance(data[key], list) or any(not isinstance(v, str) or len(v) > 200 for v in data[key])):
            errors.append(f"{key}: cần danh sách lựa chọn")
        elif isinstance(data.get(key), list) and any(v not in contract["multi_choices"][key] for v in data[key]):
            errors.append(f"{key}: lựa chọn không có trong danh mục")
    for parent, detail in SURGERY_DETAILS.items():
        if data.get(detail) and data.get(parent) != "Có" and (
            data.get(detail) != previous_data.get(detail) or data.get(parent) != previous_data.get(parent)
        ):
            errors.append(f"{detail}: chỉ nhập mô tả khi chọn Có")
    values = {}
    for key in NUMBERS | {"nam_sinh", "nam_kham"}:
        value = data.get(key)
        if value in (None, ""):
            continue
        try:
            number = Decimal(str(value))
            if not number.is_finite() or number < 0:
                raise InvalidOperation
            values[key] = number
            if (key.startswith("iota_") or key in ("roma", "sa_iota_adnex")) and number > 100:
                errors.append(f"{key}: phải từ 0 đến 100%")
            if key in ("nam_sinh", "nam_kham") and (number != int(number) or not 1900 <= number <= date.today().year):
                errors.append(f"{key}: năm không hợp lệ")
            if key == "tuoi_phau_thuat" and number > 130:
                errors.append("tuoi_phau_thuat: kiểm tra lại tuổi (0–130)")
        except (InvalidOperation, ValueError):
            errors.append(f"{key}: phải là số không âm, hữu hạn")
    if "nam_sinh" in values and "nam_kham" in values and values["nam_kham"] < values["nam_sinh"]:
        errors.append("nam_kham: không được trước năm sinh")
    for full, solid in (("sa_kich_thuoc_u", "sa_kich_thuoc_phan_dac"), ("mri_kich_thuoc_u", "mri_kich_thuoc_phan_dac")):
        if full in values and solid in values and values[solid] > values[full]:
            errors.append(f"{solid}: lớn hơn kích thước toàn bộ u, cần đối chiếu hồ sơ")
    para = str(data.get("para") or "")
    if para and (len(para) != 4 or not para.isascii() or not para.isdigit()):
        errors.append("para: cần đúng 4 chữ số")
    for key in ("treatment_date",):
        if data.get(key):
            try:
                if date.fromisoformat(str(data[key])) > date.today():
                    raise ValueError
            except ValueError:
                errors.append(f"{key}: cần ngày hợp lệ và không ở tương lai")
    # Study-specific entry convention: all SIX displayed fields total 100%.
    # This is not the standard ADNEX parent/subtype probability relationship.
    # Drafts may still contain incomplete measurements while users are typing.
    if final and any(k in values for k in IOTA):
        if not all(k in values for k in IOTA):
            errors.append("IOTA: cần nhập đủ 6 ô tỷ lệ khi có kết quả; nhập 0 nếu giá trị thực sự bằng 0")
        else:
            total = sum(values[k] for k in IOTA)
            # Only absorb machine floating-point noise, not clinical rounding differences.
            if abs(total - 100) > Decimal("0.000000001"):
                errors.append(f"IOTA: tổng cả 6 ô hiện là {format(total.normalize(), 'f')}%; phải bằng 100% theo quy ước của phiếu")
    if final:
        required = [("hospital_code", "Mã bệnh viện"), ("so_hs", "Số hồ sơ")]
        if not study_identity:
            required.append(("encounter_code", "Mã đợt điều trị"))
        for key, label in required:
            value = data.get(key)
            if not isinstance(value, str) or not value.strip() or len(value.strip()) > 100:
                errors.append(f"{key}: {label} là bắt buộc, tối đa 100 ký tự")
    if schema is not None and schema.clinical_fields is not None:
        for field in schema.clinical_fields:
            value = data.get(field.id)
            visible = not field.show_when or str(data.get(field.show_when, "")) in field.show_values
            if final and field.active and visible and field.required and (value in (None, "", []) or isinstance(value, str) and not value.strip()):
                errors.append(f"{field.id}: cần nhập thông tin bắt buộc")
            if value in (None, "", []):
                continue
            if field.type == "number":
                try:
                    number = Decimal(str(value))
                    if not number.is_finite() or field.min_value is not None and number < Decimal(str(field.min_value)) or field.max_value is not None and number > Decimal(str(field.max_value)):
                        raise InvalidOperation
                except (InvalidOperation, ValueError):
                    errors.append(f"{field.id}: giá trị số ngoài giới hạn cho phép")
            if field.type == "date":
                try:
                    if not isinstance(value, str) or len(value) != 10:
                        raise ValueError
                    date.fromisoformat(value)
                except ValueError:
                    errors.append(f"{field.id}: ngày không hợp lệ")
            if field.type in ("text", "textarea", "select") and not isinstance(value, str):
                errors.append(f"{field.id}: cần chuỗi ký tự")
    if errors:
        labels = contract["fields"]
        errors = [f"{labels.get(e.split(':', 1)[0], e.split(':', 1)[0])}:{e.split(':', 1)[1]}" if ':' in e else e for e in errors]
        raise ValidationErrorException("Vui lòng kiểm tra dữ liệu phiếu.", errors)
