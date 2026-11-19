"""Original reported units only. No conversion, inference or numeric mutation."""

BIOMARKER_KEYS = ("ca_125", "he4", "roma", "afp", "beta_hcg")
BIOMARKER_UNIT_FIELDS = tuple(key for marker in BIOMARKER_KEYS for key in (f"{marker}_unit", f"{marker}_unit_other"))
OTHER_UNIT = "Khác"
UNKNOWN_UNIT = "Chưa xác nhận"


def biomarker_configuration_errors(schema, contract):
    fields = {field.id: field for field in schema.clinical_fields or []}
    errors = []
    for marker, definition in contract.get("biomarkers", {}).items():
        unit, other = fields.get(definition["unit_field"]), fields.get(definition["other_unit_field"])
        if unit is None and other is None:
            continue
        parent = fields.get(marker)
        if parent is None or parent.type != "number" or unit is None or other is None:
            errors.append(f"{marker}: cần giữ cùng nhau kết quả số, đơn vị và ô ghi đơn vị khác")
            continue
        if unit.type != "select" or not {OTHER_UNIT, UNKNOWN_UNIT}.issubset(unit.choices):
            errors.append(f"{unit.label}: dùng Chọn một và giữ lựa chọn Khác, Chưa xác nhận")
        if other.type != "text" or other.show_when != unit.id or other.show_values != [OTHER_UNIT]:
            errors.append(f"{other.label}: dùng văn bản ngắn, chỉ hiển thị khi đơn vị là Khác")
        if unit.section != parent.section or other.section != parent.section:
            errors.append(f"{parent.label}: đặt đơn vị và đơn vị khác cùng nhóm với kết quả")
        if parent.active and (not unit.active or not other.active):
            errors.append(f"{parent.label}: giữ hiển thị các ô đơn vị khi còn thu thập kết quả")
        if parent.export and (not unit.export or not other.export):
            errors.append(f"{parent.label}: cần xuất đơn vị cùng kết quả để đối chiếu dữ liệu")
        if unit.required or other.required:
            errors.append(f"{unit.label}: hệ thống chỉ yêu cầu đơn vị khi có kết quả, không bật bắt buộc cho mọi phiếu")
    return errors


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
