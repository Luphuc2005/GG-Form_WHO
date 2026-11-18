from typing import Any, Dict, List, Optional, Set
from app.core.exceptions import ValidationErrorException
from app.schemas.form import FormFieldSchema, FormOptionSchema, FormSchemaDefinition
from app.schemas.submission import AnswersPayload, SelectedOptionPayload


class FormSchemaValidator:
    def __init__(self, schema_def: FormSchemaDefinition):
        self.schema = schema_def
        self.fields_by_id: Dict[str, FormFieldSchema] = {
            f.id: f for f in schema_def.fields
        }

    def validate(self, answers: AnswersPayload) -> None:
        """Validate an answers payload against the loaded form schema."""
        is_clinical = bool(getattr(answers, "clinical_data", None))

        # 1. Check required top-level fields
        for field_id, field_def in self.fields_by_id.items():
            if field_id == "classification":
                if not is_clinical or answers.classification != "unspecified":
                    self._validate_classification(field_def, answers.classification)
            elif field_id == "pathology":
                self._validate_pathology(field_def, answers.pathology)
            elif field_def.required and not is_clinical:
                raise ValidationErrorException(
                    f"Trường bắt buộc '{field_def.label}' ({field_id}) không có trong payload."
                )

    def _validate_classification(self, field_def: FormFieldSchema, value: Optional[str]) -> None:
        if field_def.required and (not value or not value.strip()):
            msg = field_def.error_message or f"Trường '{field_def.label}' là bắt buộc."
            raise ValidationErrorException(msg)

        if value:
            valid_ids = {opt.id for opt in field_def.options}
            if value not in valid_ids:
                raise ValidationErrorException(
                    f"Giá trị phân loại '{value}' không hợp lệ. Các lựa chọn hợp lệ: {list(valid_ids)}"
                )

    def _validate_pathology(self, field_def: FormFieldSchema, pathology_data: Any) -> None:
        if pathology_data is None:
            raise ValidationErrorException("Vui lòng chọn kết quả giải phẫu bệnh.")
        selected_list: List[SelectedOptionPayload] = pathology_data.selected
        top_other_text: Optional[str] = pathology_data.other_text
        from app.services.pathology_results import results_by_slot
        slots = results_by_slot(selected_list)

        if field_def.required and 1 not in slots:
            msg = field_def.error_message or "Vui lòng chọn ít nhất một kết quả giải phẫu bệnh."
            raise ValidationErrorException(msg)

        # Build recursive options dictionary: id -> FormOptionSchema
        root_options_map: Dict[str, FormOptionSchema] = {
            opt.id: opt for opt in field_def.options
        }

        # Track whether any node with has_other_text was selected
        primary_other_selected = False

        # Recursively validate selected options tree
        for slot, root_item in slots.items():
            if root_item.id not in root_options_map:
                raise ValidationErrorException(
                    f"Mục giải phẫu bệnh '{root_item.id}' không tồn tại trong danh mục schema."
                )

            node_def = root_options_map[root_item.id]
            is_other, text = self._validate_option_node_recursive(node_def, root_item)
            if is_other:
                if slot == 1:
                    primary_other_selected = True
                final_text = (text or (top_other_text if slot == 1 else "") or "").strip()
                if not final_text:
                    raise ValidationErrorException(f"WHO {slot}: đã chọn Khác thì cần ghi rõ kết quả.")
            elif root_item.other_text and root_item.other_text.strip():
                raise ValidationErrorException(
                    "Mục 'Khác' không được chọn nhưng lại có nội dung văn bản đi kèm."
                )
        if top_other_text and top_other_text.strip() and not primary_other_selected:
            raise ValidationErrorException("Mục 'Khác' không được chọn nhưng lại có nội dung văn bản đi kèm.")

    def _validate_option_node_recursive(
        self,
        node_def: FormOptionSchema,
        node_payload: SelectedOptionPayload
    ) -> tuple[bool, Optional[str]]:
        """
        Recursively validates that any children in node_payload are legitimate
        children of node_def, and checks other_text consistency.
        Returns: (is_other_selected, other_text_value)
        """
        is_other = bool(node_def.has_other_text)
        other_text = node_payload.other_text

        children_def_map: Dict[str, FormOptionSchema] = {
            c.id: c for c in node_def.children
        }

        for child_payload in node_payload.children:
            if child_payload.id not in children_def_map:
                raise ValidationErrorException(
                    f"Mục con '{child_payload.id}' không phải là lựa chọn con hợp lệ của '{node_def.label}' ({node_def.id})."
                )
            child_def = children_def_map[child_payload.id]
            child_is_other, child_text = self._validate_option_node_recursive(child_def, child_payload)
            if child_is_other:
                is_other = True
                other_text = child_text

        return is_other, other_text


def validate_submission_against_schema(
    schema_def: FormSchemaDefinition,
    answers: AnswersPayload
) -> None:
    validator = FormSchemaValidator(schema_def)
    validator.validate(answers)
