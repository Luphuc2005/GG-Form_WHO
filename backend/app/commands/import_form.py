import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from app.database import SessionLocal
from app.models.form_version import FormVersion
from app.models.submission import Submission
from app.schemas.form import FormSchemaDefinition
from sqlalchemy import select, func


def import_form_schema(file_path: str, force: bool = False) -> None:
    if not os.path.exists(file_path):
        print(f"LỖI: Tệp '{file_path}' không tồn tại.")
        sys.exit(1)

    with open(file_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Validate schema structure with Pydantic
    try:
        schema_def = FormSchemaDefinition.model_validate(data)
    except Exception as e:
        print(f"LỖI: Nội dung schema không hợp lệ: {e}")
        sys.exit(1)

    # Compute schema hash
    canonical_json = json.dumps(data, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
    schema_hash = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    db = SessionLocal()
    try:
        stmt = select(FormVersion).where(
            FormVersion.form_key == schema_def.form_key,
            FormVersion.version == schema_def.version
        )
        existing = db.scalars(stmt).first()

        if existing:
            if existing.schema_hash == schema_hash:
                print(f"Biểu mẫu '{schema_def.form_key}' v{schema_def.version} đã được xuất bản (Hash trùng khớp). Bỏ qua.")
                return

            # Check if submissions already exist for this version
            sub_count = db.scalar(
                select(func.count(Submission.id)).where(Submission.form_version_id == existing.id)
            ) or 0

            if sub_count > 0:
                print(
                    f"CẢNH BÁO: Biểu mẫu '{schema_def.form_key}' v{schema_def.version} "
                    f"đã có {sub_count} phiếu khảo sát. Không thể ghi đè schema đã có dữ liệu để bảo toàn tính toàn vẹn!"
                )
                return

            if not force:
                print(
                    f"Biểu mẫu '{schema_def.form_key}' v{schema_def.version} đã tồn tại. "
                    f"Dùng cờ --force nếu muốn ghi đè."
                )
                return

            print(f"Cập nhật biểu mẫu '{schema_def.form_key}' v{schema_def.version}...")
            existing.schema_json = data
            existing.schema_hash = schema_hash
            existing.published_at = datetime.now(timezone.utc)
            db.commit()
            print("Cập nhật biểu mẫu thành công.")
        else:
            print(f"Tạo mới biểu mẫu '{schema_def.form_key}' v{schema_def.version}...")
            new_ver = FormVersion(
                form_key=schema_def.form_key,
                version=schema_def.version,
                status="published",
                schema_json=data,
                schema_hash=schema_hash,
                published_at=datetime.now(timezone.utc),
            )
            db.add(new_ver)
            db.commit()
            print(f"Đã xuất bản biểu mẫu '{schema_def.form_key}' v{schema_def.version} thành công!")
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Nhập form definition JSON vào hệ thống")
    parser.add_argument("file_path", help="Đường dẫn đến file JSON của form definition")
    parser.add_argument("--force", action="store_true", help="Ghi đè nếu phiên bản chưa có submission")
    args = parser.parse_args()

    import_form_schema(args.file_path, args.force)


if __name__ == "__main__":
    main()
