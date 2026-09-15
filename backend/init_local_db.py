from app.database import engine, Base
from app.commands.import_form import import_form_schema
from app.commands.create_admin import bootstrap_admin
import os

print("1. Đang khởi tạo các bảng trong database SQLite...")
Base.metadata.create_all(bind=engine)

print("2. Đang nạp biểu mẫu khảo sát WHO v1...")
form_path = os.path.join("..", "form-definitions", "ovarian-pathology-v1.json")
if not os.path.exists(form_path):
    form_path = os.path.join("form-definitions", "ovarian-pathology-v1.json")
import_form_schema(form_path, force=True)

print("3. Đang khởi tạo tài khoản Admin (admin / admin123)...")
bootstrap_admin("admin", "admin123")

print("\n✅ Khởi tạo CSDL SQLite cục bộ thành công!")
