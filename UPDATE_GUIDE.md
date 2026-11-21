# Cập nhật hệ thống trên nhánh main

Chị Linh đang dùng bản cập nhật giao diện riêng/form v3: dùng [hướng dẫn triển khai lại từ v3](deploy/HUONG_DAN_DEPLOY_LAI_CHO_LINH.md). Lệnh build riêng nginx của bản cũ không đủ cho hàng đợi Excel, worker và migration mới.

## PostgreSQL và Docker Compose

Xem [cấu hình bàn giao](DEPLOYMENT_FOR_TEACHER.md) và bổ sung cấu hình `.env` trước khi cập nhật. Giữ volume đang phục vụ dữ liệu.

```bash
git rev-parse HEAD
bash scripts/update.sh
```

Luồng cập nhật sao lưu bằng `pg_dump`, kéo `origin/main` theo fast-forward, build Docker images, dừng backend/Nginx trong lúc migration, rồi chạy lại và kiểm tra health. Nếu bước nào lỗi, script trả mã lỗi. Giữ bản sao PostgreSQL và commit cũ đến khi kiểm tra phiếu cũ, đăng nhập và export thành công. Nếu script hiện có là bản cũ, đi theo trình tự nâng cấp lần đầu trong [tài liệu bàn giao](DEPLOYMENT_FOR_TEACHER.md).

Cập nhật Web App cùng bản backend nếu dùng Google Sheets. Xem [hướng dẫn cài Apps Script và token](GOOGLE_SHEETS_GUIDE.md).

## Nếu nâng cấp lỗi

Preflight chạy bằng image mới trước khi dừng bản cũ, kiểm tra database, phiên bản migration, cấu hình Sheet và quyền cài `pg_trgm`. Lỗi build/preflight không dừng ứng dụng đang phục vụ. `deploy.sh` lưu tên ảnh container cũ trong `backups/deploy-*/backend-image.txt`, `nginx-image.txt` và giữ một tag Docker tương ứng. Script update lưu commit trước khi pull trong `backups/last-checkout-before-update.txt`.

Nếu migration hoặc kiểm tra sau migration lỗi, giữ ứng dụng ở trạng thái dừng đến khi xử lý xong. Không chạy `docker compose down -v`, không `stamp head` để vượt kiểm tra, không import cấu hình local lên form bệnh viện để chữa lỗi cột. Xem `docker compose logs --tail=100 backend worker backup`, kết quả `docker compose run --rm --no-deps backend alembic current` và `docker compose run --rm --no-deps backend python -m app.commands.check_deployment --before-migration`. Các lệnh này không gửi bệnh án lên Sheet.

Khắc phục kết nối/quyền/cấu hình rồi chạy lại `bash scripts/deploy.sh`; migration và khởi tạo được thiết kế chạy lại an toàn. Khi cần quay về bản cũ, người triển khai cần phối hợp tag image/commit với bản sao database tương ứng, sau khi dừng toàn bộ tiến trình ghi. Không tự restore lên database đang có người nhập và không tự downgrade các phiên bản form đã có phiếu. Nếu migration đã chạy thành công, ưu tiên sửa tiếp bản mới trước khi cân nhắc phục hồi dữ liệu từ bản sao.

## Phiên bản biểu mẫu

Tài khoản có vai trò admin mở `/admin/form-builder` để lưu nháp, xem trước và xuất bản cấu hình mới. Phiếu cũ và bản nháp đã tạo tiếp tục tham chiếu phiên bản biểu mẫu của chúng. Xem [hướng dẫn quản lý biểu mẫu](FORM_MANAGEMENT_GUIDE.md).
