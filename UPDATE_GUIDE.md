# Cập nhật hệ thống trên nhánh main

## PostgreSQL và Docker Compose

Xem [cấu hình bàn giao](DEPLOYMENT_FOR_TEACHER.md) và bổ sung cấu hình `.env` trước khi cập nhật. Giữ volume đang phục vụ dữ liệu.

```bash
git rev-parse HEAD
bash scripts/update.sh
```

Luồng cập nhật sao lưu bằng `pg_dump`, kéo `origin/main` theo fast-forward, build Docker images, dừng backend/Nginx trong lúc migration, rồi chạy lại và kiểm tra health. Nếu bước nào lỗi, script trả mã lỗi. Giữ bản sao PostgreSQL và commit cũ đến khi kiểm tra phiếu cũ, đăng nhập và export thành công. Nếu script hiện có là bản cũ, đi theo trình tự nâng cấp lần đầu trong [tài liệu bàn giao](DEPLOYMENT_FOR_TEACHER.md).

Cập nhật Web App cùng bản backend nếu dùng Google Sheets. Xem [hướng dẫn cài Apps Script và token](GOOGLE_SHEETS_GUIDE.md).

## Phiên bản biểu mẫu

Tài khoản có vai trò admin mở `/admin/form-builder` để lưu nháp, xem trước và xuất bản cấu hình mới. Phiếu cũ và bản nháp đã tạo tiếp tục tham chiếu phiên bản biểu mẫu của chúng. Xem [hướng dẫn quản lý biểu mẫu](FORM_MANAGEMENT_GUIDE.md).
