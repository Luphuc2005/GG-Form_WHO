# Bàn giao triển khai GG-Form WHO

Nhánh triển khai là `main`. Hệ thống chạy React và FastAPI sau Nginx, dùng PostgreSQL 16 trong volume `ovarian_survey_postgres_data`. Bản này có lưu nháp, mã nghiên cứu, quản lý phiếu, WHO 1/WHO 2, quản lý phiên bản biểu mẫu và xuất Excel/CSV.

## Máy chủ và cấu hình

Cần Linux, Git, Docker Engine, Docker Compose v2 có hỗ trợ `up --wait`, curl và một reverse proxy HTTPS. Chạy các lệnh dưới đây bằng tài khoản được cấp quyền Docker.

Tệp [.env.example](.env.example) liệt kê cấu hình Docker. Các giá trị thật đặt trong `.env` ở gốc checkout trên máy chủ và giới hạn quyền đọc. Frontend gọi API cùng tên miền qua `/api/` nên không cần tệp môi trường riêng.

| Biến | Giá trị cần chuẩn bị |
| --- | --- |
| `APP_ENV` | Giữ `production`. Trình duyệt dùng HTTPS cho cookie đăng nhập admin. |
| `DOMAIN`, `CORS_ORIGINS` | Tên miền thực, ví dụ `survey.example.edu.vn` và `https://survey.example.edu.vn`. Thiết lập DNS/TLS ở reverse proxy. |
| `APP_HTTP_BIND`, `APP_HTTP_PORT` | `127.0.0.1` và `8080` nếu reverse proxy chạy trên cùng máy. Trỏ HTTPS proxy tới `http://127.0.0.1:8080`. |
| `POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD` | Giữ thông tin hiện có khi tái sử dụng volume. Khi cài mới, có thể tạo mật khẩu bằng `openssl rand -hex 32`. |
| `SECRET_KEY` | Dùng một giá trị riêng, có thể tạo bằng `openssl rand -hex 32`. Giữ khóa hiện có nếu muốn giữ hiệu lực phiên đăng nhập. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Dùng để khởi tạo tài khoản. Đổi biến mật khẩu không đặt lại mật khẩu của tài khoản đã tồn tại. |
| `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_SPREADSHEET_ID`, `GOOGLE_SHEETS_WEBHOOK_TOKEN` | Điền đủ ba biến nếu cần Google Sheets. Token là biến mới và phải khớp với Script Properties của Apps Script. Có thể để trống cả ba để triển khai ứng dụng trước. |

Compose tự dựng `DATABASE_URL` từ thông tin PostgreSQL. Nếu mật khẩu cũ có ký tự đặc biệt trong URL, đặt `DATABASE_URL` rõ ràng và mã hóa phần mật khẩu theo URL. Đổi `POSTGRES_PASSWORD` trong tệp môi trường không đổi mật khẩu bên trong volume đã khởi tạo.

## Cài mới

```bash
git clone --branch main https://github.com/Luphuc2005/GG-Form_WHO.git
cd GG-Form_WHO
cp .env.example .env
chmod 600 .env
nano .env
bash scripts/deploy.sh
```

Script build hai image, chờ PostgreSQL sẵn sàng, chạy Alembic đến `007_ultrasound_conclusion`, nhập biểu mẫu ban đầu, tạo admin rồi kiểm tra frontend, backend, database và API biểu mẫu. Migration `006_submission_trash` thêm thông tin thùng rác. Migration `007_ultrasound_conclusion` xuất bản phiên bản kế tiếp có ô kết luận siêu âm nếu máy chủ đang dùng biểu mẫu được quản lý bằng cấu hình và còn thiếu ô này. Phiếu cũ tiếp tục gắn với phiên bản trước. Nginx phục vụ ứng dụng qua cổng đã khai báo. Cấu hình chứng chỉ và reverse proxy ở lớp HTTPS của máy chủ theo [hướng dẫn Nginx](DEPLOYMENT.md).

## Nâng cấp máy chủ đang chạy

1. Giữ checkout, volume PostgreSQL và `.env` hiện có. Bổ sung giá trị thiếu theo bảng trên, đặc biệt là `POSTGRES_PASSWORD` phải khớp với volume. Giữ bản sao Sheet nếu đang đồng bộ.
2. Chạy trong checkout của máy chủ. Script tạo bản sao PostgreSQL trước khi kéo mã, build image, tạm dừng ứng dụng trong lúc migration và mở lại sau khi đã kiểm tra.

   ```bash
   bash scripts/update.sh
   ```

   Nếu checkout vẫn đang dùng bản cũ của script, chạy các lệnh sau để sao lưu bản đang chạy trước khi kéo mã. Chạy trong Bash và dừng nếu lệnh báo lỗi.

   ```bash
   set -e
   umask 077
   backup="$HOME/gg-form-who-before-$(date +%Y%m%d-%H%M%S).dump"
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$backup"
   docker compose exec -T postgres pg_restore --list < "$backup" >/dev/null
   git rev-parse HEAD
   git pull --ff-only origin main
   bash scripts/deploy.sh
   ```

   Giữ tệp dump và commit cũ để phục hồi khi cần. Tham khảo [hướng dẫn cập nhật](UPDATE_GUIDE.md) và [sao lưu](BACKUP_GUIDE.md).

3. Nếu dùng Sheets, cập nhật Web App từ [deploy/google_apps_script.js](deploy/google_apps_script.js), thêm hai Script Properties và kiểm tra token theo [hướng dẫn Google Sheets](GOOGLE_SHEETS_GUIDE.md). Sau khi cập nhật `.env`, chạy `docker compose up -d --wait backend` rồi `docker compose restart nginx`.

## Kiểm tra sau khi triển khai

- Chạy `bash scripts/healthcheck.sh` và xác nhận `https://<ten-mien>/health/ready` trả HTTP 200.
- Mở `/` để kiểm tra biểu mẫu, đăng nhập tại `/admin`, mở `/admin/form-builder` bằng tài khoản admin và thử xuất Excel/CSV.
- Dùng một phiếu giả trên môi trường thử để kiểm tra lưu nháp, gửi phiếu, WHO 1/WHO 2 và đối chiếu với Sheet nếu đã kết nối. Kiểm tra một phiếu cũ sau đợt nâng cấp.
- Khi cần xem lỗi, dùng `docker compose ps` và `docker compose logs --tail=100 backend nginx postgres`.
