"""Original reported units only. No conversion, inference or numeric mutation."""

BIOMARKER_KEYS = ("ca_125", "he4", "roma", "afp", "beta_hcg")
BIOMARKER_UNIT_FIELDS = tuple(key for marker in BIOMARKER_KEYS for key in (f"{marker}_unit", f"{marker}_unit_other"))
OTHER_UNIT = "Khác"
UNKNOWN_UNIT = "Chưa xác nhận"


def validate_biomarker_units(data, contract, previous_data, final=False, schema=None):
    errors = []
    configured = {field.id: field for field in schema.clinical_fields or []} if schema is not None else {}
    for marker, definition in contract.get("biomarkers", {}).items():
        unit_key, other_key = definition["unit_field"], definition["other_unit_field"]
        unit, other = data.get(unit_key), data.get(other_key)
        if other not in (None, ""):
            if not isinstance(other, str) or len(other) > 200:
                errors.append(f"{other_key}: cần nội dung tối đa 200 ký tự")
            elif unit != OTHER_UNIT and (other != previous_data.get(other_key) or unit != previous_data.get(unit_key)):
                errors.append(f"{other_key}: chỉ ghi đơn vị khác khi chọn Khác")
        # Only newly configured form versions require a unit. Historical forms
        # keep their pinned rules, including results saved before units existed.
        parent, unit_field = configured.get(marker), configured.get(unit_key)
        enabled = parent is not None and parent.active and unit_field is not None and unit_field.active
        has_value = data.get(marker) not in (None, "")
        if final and enabled and has_value:
            if not isinstance(unit, str) or not unit.strip():
                errors.append(f"{unit_key}: chọn đơn vị trên phiếu xét nghiệm; chọn Chưa xác nhận nếu chưa đối chiếu được")
            elif unit == OTHER_UNIT and (not isinstance(other, str) or not other.strip()):
                errors.append(f"{other_key}: ghi rõ đơn vị/dạng kết quả trên phiếu xét nghiệm")
    return errors
