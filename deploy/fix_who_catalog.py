"""Publish the repository's 20-option WHO catalog as a new form version.

Run from /app inside the backend container. See HUONG_DAN_SUA_WHO_20.md.
The default invocation only reports the proposed update. Use --apply to publish.
"""
import argparse
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys

# This file can be copied into /tmp while the backend runs from /app.
sys.path.insert(0, str(Path.cwd()))

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app.database import SessionLocal
from app.models.form_version import FormVersion
from app.schemas.form import FormSchemaDefinition


def upgrade_catalog(db, definition, apply=False):
    target = FormSchemaDefinition.model_validate(definition)
    if target.form_key != "ovarian-pathology-who":
        raise RuntimeError("Tệp nguồn phải là biểu mẫu ovarian-pathology-who.")
    target_fields = [field for field in target.fields if field.id == "pathology"]
    if len(target_fields) != 1 or len(target_fields[0].options) != 20:
        raise RuntimeError("Tệp nguồn cần có đúng danh mục WHO 20 lựa chọn đã được bàn giao.")
    target_field = target_fields[0].model_dump(mode="json")
    if len({option.id for option in target_fields[0].options}) != 20:
        raise RuntimeError("Danh mục nguồn có mã lựa chọn WHO bị trùng.")

    for attempt in range(3):
        current = db.scalar(select(FormVersion).where(
            FormVersion.form_key == target.form_key,
            FormVersion.status == "published",
        ).order_by(FormVersion.version.desc()).limit(1).with_for_update())
        if current is None:
            raise RuntimeError("Chưa có biểu mẫu. Chạy import_form để khởi tạo trước.")
        parsed = FormSchemaDefinition.model_validate(current.schema_json)
        old_fields = [field for field in parsed.fields if field.id == "pathology"]
        if len(old_fields) != 1:
            raise RuntimeError("Biểu mẫu hiện tại chưa có đúng một trường pathology để cập nhật.")
        # Read the actual catalog. Historical schema_hash values may be stale.
        matches = old_fields[0].model_dump(mode="json") == target_field
        report = {
            "status": "already_current" if matches else "preview",
            "current_version": current.version,
            "current_options": len(old_fields[0].options),
            "target_options": 20,
        }
        if matches or not apply:
            db.rollback()
            return report

        raw = deepcopy(current.schema_json)
        raw["fields"] = [
            deepcopy(target_field) if field["id"] == "pathology" else field
            for field in raw["fields"]
        ]
        # Include archived versions when allocating the next unique version.
        version = db.scalar(select(func.max(FormVersion.version)).where(
            FormVersion.form_key == target.form_key,
        )) + 1
        latest_id = db.scalar(select(FormVersion.id).where(
            FormVersion.form_key == target.form_key, FormVersion.status == "published",
        ).order_by(FormVersion.version.desc()).limit(1))
        if latest_id != current.id:
            db.rollback()
            if attempt == 2:
                raise RuntimeError("Biểu mẫu đang được xuất bản ở phiên khác. Chạy lại bản vá sau.")
            continue
        raw["version"] = version
        canonical = json.dumps(raw, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        db.add(FormVersion(
            form_key=target.form_key, version=version, status="published", schema_json=raw,
            schema_hash=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
            published_at=datetime.now(timezone.utc),
        ))
        try:
            db.commit()
            report.update(status="published", published_version=version)
            return report
        except IntegrityError:
            db.rollback()
            if attempt == 2:
                raise RuntimeError("Có phiên xuất bản đồng thời. Chạy lại để đối chiếu phiên bản mới nhất.") from None


def main():
    parser = argparse.ArgumentParser(description="Kiểm tra hoặc xuất bản danh mục WHO 20 lựa chọn.")
    parser.add_argument("--definition", required=True, help="Tệp JSON danh mục hiện tại trong GitHub.")
    parser.add_argument("--apply", action="store_true", help="Xuất bản phiên bản mới nếu danh mục đang khác.")
    args = parser.parse_args()
    definition = json.loads(Path(args.definition).read_text(encoding="utf-8"))
    with SessionLocal() as db:
        report = upgrade_catalog(db, definition, apply=args.apply)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
