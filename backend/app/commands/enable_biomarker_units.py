"""Publish original-unit inputs without rewriting form history or clinical data.

Default: preview only. Run with --apply after reviewing the report.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json

from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models.form_management import FormDraft, FormSheetJob
from app.models.form_version import FormVersion
from app.models.submission import Submission, EXPORTABLE_STATES
from app.schemas.form import FormSchemaDefinition
from app.services.biomarker_units import BIOMARKER_KEYS, BIOMARKER_UNIT_FIELDS
from app.services.form_configuration import FORM_KEY, all_versions, baseline_fields, validate_configuration


def with_biomarker_units(raw):
    result = deepcopy(raw)
    defaults = {field.id: field for field in baseline_fields()}
    original = result.get("clinical_fields")
    fields = deepcopy(original) if original is not None else [field.model_dump(mode="json") for field in defaults.values()]
    by_id = {field["id"]: field for field in fields}
    if any(marker not in by_id for marker in BIOMARKER_KEYS):
        raise RuntimeError("Biểu mẫu cần có đủ 5 chỉ số CA 125, HE4, ROMA, AFP, beta hCG trước khi thêm đơn vị.")
    missing = [key for key in BIOMARKER_UNIT_FIELDS if original is None or key not in by_id]
    inserted = []
    for field in fields:
        inserted.append(field)
        if field["id"] not in BIOMARKER_KEYS:
            continue
        for key in (f"{field['id']}_unit", f"{field['id']}_unit_other"):
            if key in by_id:
                continue
            extra = defaults[key].model_dump(mode="json")
            extra.update(section=field["section"], active=field.get("active", True), export=field.get("export", True))
            inserted.append(extra)
    result["clinical_fields"] = inserted
    return result, missing


def publish_biomarker_units(db, apply=False):
    for attempt in range(3):
        current = db.scalar(select(FormVersion).where(FormVersion.form_key == FORM_KEY,
            FormVersion.status == "published").order_by(FormVersion.version.desc()).limit(1).with_for_update())
        if current is None:
            raise RuntimeError("Chưa có biểu mẫu để bổ sung đơn vị xét nghiệm.")
        raw, missing = with_biomarker_units(current.schema_json)
        candidate = FormSchemaDefinition.model_validate(raw)
        validate_configuration(candidate, current.schema_json, all_versions(db))
        draft = db.scalar(select(FormDraft).where(FormDraft.form_key == FORM_KEY).with_for_update())
        report = {"status": "preview" if missing else "already_enabled", "current_version": current.version,
                  "new_field_ids": missing, "pending_configuration_draft": draft is not None,
                  "preserved_custom_questions": sum(field["id"].startswith("custom_") for field in raw["clinical_fields"])}
        if not missing or not apply:
            db.rollback()
            return report
        if draft is not None:
            db.rollback()
            raise RuntimeError("Có bản nháp Quản lý biểu mẫu chưa xuất bản. Hoàn tất bản nháp đó trên web rồi chạy lại; cấu hình đang sửa được giữ nguyên.")
        next_version = db.scalar(select(func.max(FormVersion.version)).where(FormVersion.form_key == FORM_KEY)) + 1
        latest = db.scalar(select(FormVersion.id).where(FormVersion.form_key == FORM_KEY,
            FormVersion.status == "published").order_by(FormVersion.version.desc()).limit(1))
        if latest != current.id:
            db.rollback()
            continue
        raw["version"] = next_version
        canonical = json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        db.add(FormVersion(form_key=FORM_KEY, version=next_version, status="published", schema_json=raw,
                           schema_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(), published_at=datetime.now(timezone.utc)))
        job = db.get(FormSheetJob, FORM_KEY)
        if job:
            job.target_version, job.status, job.attempts, job.error = next_version, "pending", 0, None
        else:
            db.add(FormSheetJob(form_key=FORM_KEY, target_version=next_version, status="pending"))
        db.execute(update(Submission).where(Submission.workflow_status.in_(EXPORTABLE_STATES),
            Submission.sync_status != "syncing").values(sync_status="pending", sync_attempts=0, sync_error=None))
        try:
            db.commit()
            report.update(status="published", published_version=next_version)
            return report
        except IntegrityError:
            db.rollback()
    raise RuntimeError("Có phiên xuất bản đồng thời. Chạy lại để đối chiếu cấu hình mới nhất.")


def main():
    parser = argparse.ArgumentParser(description="Xem trước hoặc bật đơn vị gốc cho 5 chỉ số xét nghiệm.")
    parser.add_argument("--apply", action="store_true", help="Xuất bản phiên bản mới, giữ nguyên phiếu và cấu hình cũ.")
    args = parser.parse_args()
    with SessionLocal() as db:
        report = publish_biomarker_units(db, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
