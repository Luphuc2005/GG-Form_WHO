import os

from app.database import engine, Base
from app.commands.import_form import import_form_schema
from app.commands.create_admin import bootstrap_admin
from app.config import get_settings

if not get_settings().DATABASE_URL.startswith("sqlite"):
    raise RuntimeError("init_local_db.py chỉ dùng cho SQLite local. Với PostgreSQL hãy sao lưu và chạy alembic upgrade head.")

print("1. Đang khởi tạo các bảng trong database SQLite...")
from upgrade_db import upgrade_database
upgrade_database()

print("2. Đang nạp biểu mẫu khảo sát WHO v1...")
form_path = os.path.join("..", "form-definitions", "ovarian-pathology-v1.json")
if not os.path.exists(form_path):
    form_path = os.path.join("form-definitions", "ovarian-pathology-v1.json")
import_form_schema(form_path, force=True)

print("3. Đang kiểm tra tài khoản quản trị (giữ mật khẩu nếu đã tồn tại)...")
bootstrap_admin()

print("\n✅ Khởi tạo CSDL SQLite cục bộ thành công!")
