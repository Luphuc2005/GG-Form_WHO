import csv
import io
from datetime import datetime
from typing import Any, Dict, Generator, List, Optional, Set, Tuple
from sqlalchemy.orm import Session
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.repositories.form_repo import FormRepository
from app.repositories.submission_repo import SubmissionRepository
from app.schemas.form import FormOptionSchema, FormSchemaDefinition


class ExportService:
    @staticmethod
    def get_columns_from_schema(schema_def: FormSchemaDefinition) -> List[Tuple[str, str, str]]:
        """
        Extract flat columns from schema for wide-format export.
        Returns list of (column_key, column_label, combined_header)
        """
        columns: List[Tuple[str, str, str]] = [
            ("submission_uuid", "Mã phiếu (UUID)", "Mã phiếu (submission_uuid)"),
            ("created_at", "Thời gian gửi (Giờ VN)", "Thời gian gửi (created_at)"),
            ("form_version", "Phiên bản form", "Phiên bản form (form_version)"),
            ("classification", "Phân loại Lành/Ác", "Phân loại Lành/Ác (classification)"),
        ]

        pathology_field = next((f for f in schema_def.fields if f.id == "pathology"), None)
        if pathology_field:
            def recurse_options(options: List[FormOptionSchema], prefix: str = "gpb_"):
                for opt in options:
                    col_id = f"{prefix}{opt.id}"
                    combined = f"{opt.label} ({col_id})"
                    columns.append((col_id, opt.label, combined))
                    if opt.has_other_text:
                        columns.append((f"{col_id}_other_selected", f"{opt.label} - Đã chọn (1/0)", f"{opt.label} - Đã chọn ({col_id}_selected)"))
                        columns.append((f"{col_id}_other_text", f"{opt.label} - Ghi rõ", f"{opt.label} - Ghi rõ ({col_id}_text)"))
                    if opt.children:
                        recurse_options(opt.children, prefix=f"{col_id}__")

            recurse_options(pathology_field.options)

        return columns

    @classmethod
    def stream_csv(
        cls,
        db: Session,
        form_version_num: Optional[int] = None
    ) -> Generator[str, None, None]:
        """
        Memory-safe streaming CSV exporter with UTF-8 BOM for Microsoft Excel.
        Streams row by row without buffering all rows in memory.
        """
        # Yield UTF-8 BOM first
        yield "\ufeff"

        # Resolve schema to construct headers
        if form_version_num is not None:
            form_ver = FormRepository.get_by_key_and_version(db, "ovarian-pathology-who", form_version_num)
        else:
            form_ver = FormRepository.get_published_by_key(db, "ovarian-pathology-who")

        if not form_ver:
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(["Error: Form version not found"])
            yield output.getvalue()
            return

        schema_def = FormSchemaDefinition.model_validate(form_ver.schema_json)
        columns = cls.get_columns_from_schema(schema_def)

        # Write header row (Labels with Variable names: "U tuyến... (gpb_serous_benign)")
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([col[2] for col in columns])
        yield output.getvalue()

        # Stream submissions using DB cursor
        for sub in SubmissionRepository.stream_all(db, form_version=form_version_num, batch_size=1000):
            row_data = cls._flatten_submission_to_row(sub, columns)
            output = io.StringIO()
            writer = csv.writer(output)
            writer.writerow(row_data)
            yield output.getvalue()

    @classmethod
    def _flatten_submission_to_row(
        cls,
        submission: Submission,
        columns: List[Tuple[str, str, str]]
    ) -> List[Any]:
        # Collect all selected option IDs and their full paths
        answers = submission.answers or {}
        pathology = answers.get("pathology", {})
        selected_nodes = pathology.get("selected", [])
        top_other_text = pathology.get("other_text", "")

        selected_paths: Set[str] = set()
        other_texts: Dict[str, str] = {}

        def traverse_selected(nodes: List[Dict[str, Any]], prefix: str = "gpb_"):
            for node in nodes:
                node_id = node.get("id")
                if not node_id:
                    continue
                path = f"{prefix}{node_id}"
                selected_paths.add(path)
                if node.get("other_text"):
                    other_texts[path] = node["other_text"]
                children = node.get("children", [])
                if children:
                    traverse_selected(children, prefix=f"{path}__")

        traverse_selected(selected_nodes)

        # Map to columns
        row = []
        from datetime import timedelta
        if submission.created_at:
            created_vn = (submission.created_at + timedelta(hours=7)).strftime("%H:%M:%S %d/%m/%Y")
        else:
            created_vn = ""

        for col_info in columns:
            col_key = col_info[0]
            if col_key == "submission_uuid":
                row.append(str(submission.submission_uuid))
            elif col_key == "created_at":
                row.append(created_vn)
            elif col_key == "form_version":
                row.append(submission.form_version.version if submission.form_version else 1)
            elif col_key in ("classification", "lanh_ac"):
                row.append(submission.classification or "")
            elif col_key.endswith("_other_selected"):
                base_key = col_key[:-len("_other_selected")]
                row.append(1 if base_key in selected_paths else 0)
            elif col_key.endswith("_other_text"):
                base_key = col_key[:-len("_other_text")]
                text = other_texts.get(base_key, "") or top_other_text if base_key in selected_paths else ""
                row.append(text)
            else:
                # Regular pathology option
                row.append(1 if col_key in selected_paths else 0)

        return row
