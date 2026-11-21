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

Script build hai image, chờ PostgreSQL sẵn sàng, chạy Alembic đến `010_search_indexes`, nhập biểu mẫu ban đầu, tạo admin rồi kiểm tra ứng dụng. Migration `008_sheet_cleanup` lưu bản sao và hàng đợi dọn Sheet; `009_capacity_jobs` thêm hàng đợi Excel và chỉ mục danh sách/hàng chờ; `010_search_indexes` tạo `pg_trgm` cùng sáu chỉ mục tìm kiếm trên PostgreSQL. Tài khoản migration cần quyền CREATE trên database để cài extension này. Phiếu cũ tiếp tục gắn với phiên bản trước. Phải chạy migration trước khi mở backend/worker mới. Nginx phục vụ ứng dụng qua cổng đã khai báo. Cấu hình chứng chỉ và reverse proxy ở lớp HTTPS của máy chủ theo [hướng dẫn Nginx](DEPLOYMENT.md).

## Nâng cấp máy chủ đang chạy

Máy chủ của chị Linh đang dùng hướng dẫn cập nhật frontend riêng trước đây: thực hiện theo [hướng dẫn triển khai lại từ form v3](deploy/HUONG_DAN_DEPLOY_LAI_CHO_LINH.md). Bản mới kiểm tra migration, worker và backup; không chỉ kiểm tra trang chủ trả HTTP 200.

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

3. Nếu dùng Sheets, cập nhật Web App từ [deploy/google_apps_script.js](deploy/google_apps_script.js), thêm hai Script Properties và kiểm tra token theo [hướng dẫn Google Sheets](GOOGLE_SHEETS_GUIDE.md). Sau khi cập nhật `.env`, chạy `docker compose up -d --wait backend worker backup` rồi `docker compose restart nginx`.

## Kiểm tra sau khi triển khai

- Chạy `bash scripts/healthcheck.sh` và xác nhận `https://<ten-mien>/health/ready` trả HTTP 200.
- Mở `/` để kiểm tra biểu mẫu, đăng nhập tại `/admin`, mở `/admin/form-builder` bằng tài khoản admin và thử xuất Excel/CSV.
- Dùng một phiếu giả trên môi trường thử để kiểm tra lưu nháp, gửi phiếu, WHO 1/WHO 2 và đối chiếu với Sheet nếu đã kết nối. Kiểm tra một phiếu cũ sau đợt nâng cấp.
- Khi cần xem lỗi, dùng `docker compose ps` và `docker compose logs --tail=100 backend worker backup nginx postgres`.

## Rà soát trước triển khai ngày 21/11/2026

Đã sửa thêm hai lỗi giao diện: đổi tên một lựa chọn giờ cập nhật điều kiện của các câu hỏi phụ tương ứng; tên câu hỏi hoặc lựa chọn dài không làm tràn khung chỉnh sửa và form nhập liệu trên màn hình hẹp. Lệnh nhập cấu hình quản lý từ CLI cũng tạo hàng đợi cập nhật cột và đồng bộ lại phiếu, tương tự thao tác xuất bản trong giao diện. Nhập lại cùng tệp không tạo thêm phiên bản hoặc xếp lại công việc đã hoàn tất; nhập phiên bản lịch sử không đưa Sheet về phiên bản cũ.

| Kiểm tra | Kết quả |
| --- | --- |
| Backend, bao gồm migration và hàng đợi | 220 kiểm tra qua trên SQLite cô lập |
| Frontend TypeScript và bản build Vite | Qua |
| Apps Script: đổi tên/thêm/bỏ cột, thử lại, cột lạ, xác thực, font | Qua trên Sheet giả |
| Thêm sáu kiểu câu hỏi, thêm ô số lượng có điều kiện, lưu nháp, xem trước, xuất bản | Qua trên trình duyệt |
| Gửi phiếu → đồng bộ; sửa phiếu → giả lập HTTP lỗi → thử lại | Đọc lại đúng phiên bản mới nhất, không trùng dòng trên Sheet giả qua HTTP |
| Xuất bản lần hai: đổi tên cột, thêm câu hỏi; kiểm tra phiếu cũ | Dữ liệu giữ đúng cột; phiếu cũ giữ phiên bản; cột mới để trống |
| Bố cục | 24 trường hợp trên Chrome/Edge, rộng 320/375/390/768/1024/1440 px; không tràn ngang hoặc mất ô nhập |
| Xuất CSV/Excel | Đọc lại được cột đã đổi tên, số 0, ngày và dữ liệu sau chỉnh sửa |

Đây là kiểm tra local và môi trường thử. PostgreSQL 16 và image Docker đã được kiểm tra riêng với 20.000 phiếu giả; chưa xác minh máy chủ đích hoặc iPhone/Safari thật. Sau triển khai vẫn cần kiểm tra HTTPS, quyền Apps Script và kết nối Sheet thật của máy chủ.

### Giữ đúng cấu hình câu hỏi khi chuyển máy chủ

Tệp [ovarian-pathology-managed-v5.json](form-definitions/ovarian-pathology-managed-v5.json) chỉ chứa cấu hình 81 mã câu hỏi và danh mục WHO, không chứa bệnh án, tài khoản hoặc khóa kết nối. V5 giữ lại mã `custom_eb7f5f353789` để bảo toàn lịch sử nhưng ngừng hiển thị/xuất câu **Số lượng u** bị trùng; giữ câu **Số lượng u (Phẫu thuật)** đang có dữ liệu và hai cột dịch nang MRI T1W/T2W. V4 là bản trước khi xử lý câu trùng.

Trước khi nạp, kiểm tra `/api/v1/forms/current` trên máy chủ và sao lưu database/Sheet. Nếu máy chủ có phiên bản mới hơn v5 hoặc phiên bản v5 có nội dung khác, giữ cấu hình máy chủ và đối chiếu trong Quản lý biểu mẫu; không dùng `--force` để ghi đè. Nếu câu hỏi trùng có dữ liệu trên máy chủ, cần đối chiếu/gộp giá trị trước khi ngừng xuất cột. Nếu máy chủ còn cấu hình cũ phù hợp với bộ bàn giao này, sau khi build image mới và chạy migration, nạp tệp bằng:

```bash
docker compose run --rm backend python -m app.commands.import_form form-definitions/ovarian-pathology-managed-v5.json
```

Tiến trình `worker` sẽ xử lý hàng đợi vừa tạo. Vào **Quản lý biểu mẫu → Phiên bản & đồng bộ**, đợi xác nhận cấu trúc cột thành công rồi kiểm tra trạng thái từng phiếu. Việc chỉ kéo code không tự phục hồi các định nghĩa câu hỏi tùy chỉnh bị thiếu trong database.

Các thay đổi phải được đưa vào commit triển khai trước khi người triển khai chạy `git pull`; kết quả kiểm tra working tree local không chứng minh `origin/main` đã chứa bản sửa.

### Bố cục Sheet và các tab bệnh viện

Sheet thật hiện có **Tổng hợp** (`gid=0`) và năm tab TD/HV/YD/GD/UB. Các tab bệnh viện dùng công thức FILTER động theo cột **Mã bệnh viện**, bao gồm tiêu đề ngay cả khi bệnh viện chưa có phiếu; dữ liệu và cột mới được lấy từ Tổng hợp. Các tab này có bộ lọc **Giai đoạn nghiên cứu** để chọn R/P. Chỉnh sửa bệnh án trên ứng dụng. Cột ID đồng bộ, cột mã đợt lặp lại, cột bệnh viện 1/0 và cột MRI gộp cũ được ẩn, dữ liệu vẫn còn.

Các tab bệnh viện đã được đối chiếu với Tổng hợp sau khi tổ chức cột và dọn phiếu đã xóa. Số dòng thay đổi theo dữ liệu hiện có; người triển khai cần đối chiếu với database máy chủ, không dùng số dòng của máy local làm chuẩn. Dọn dòng cũ cần xác nhận riêng và có bản sao lưu tải xuống trên trang quản lý.

**Cần triển khai Phiên bản mới của Web App từ `deploy/google_apps_script.js`.** Bản mới công bố `batch_version: 1`, `layout_version: 2`. Nó giữ nhóm cột, thu gọn phần lưới trống và cấp số hàng theo lượng phiếu từng bệnh viện. Backend vẫn hỗ trợ script cũ, nhưng script cũ không có luồng gửi theo lô dành cho dữ liệu lớn.

Sau khi cập nhật script, bấm **Thử lại đồng bộ cột** trong Quản lý biểu mẫu, đợi trạng thái xác minh thành công; thử thêm một câu hỏi giả trên môi trường thử và đối chiếu các tab bệnh viện. Bảng dữ liệu dùng Arial 12, tiêu đề Arial 13, màu theo nhóm và chiều cao dòng 48 px để tránh dòng trống quá lớn khi tự căn chiều cao.

## Vận hành khoảng 20.000 hồ sơ

Compose có năm dịch vụ: PostgreSQL, API `backend`, tiến trình `worker`, Nginx và `backup`. API không chạy hàng đợi trong từng web process (`RUN_BACKGROUND_WORKERS=false`); worker xử lý đồng bộ và tạo Excel riêng, có healthcheck. API và worker dùng chung volume `ovarian_survey_export_data`. Không phục vụ thư mục này trực tiếp qua Nginx: tải file đi qua kiểm tra đăng nhập và chủ yêu cầu.

- `SHEETS_SYNC_BATCH_SIZE=100`: tối đa 200 phiếu/lô, tự chia thêm khi nội dung vượt khoảng 1,5 MB. Chỉ các phiếu đang chờ/thử lại được gửi; bấm Đồng bộ lại chủ động đối chiếu lại toàn bộ.
- **Xuất Excel mới** tạo yêu cầu nhanh, hiện tiến độ và liên kết tải khi sẵn sàng. Tải lại trang vẫn xem được yêu cầu. File là ảnh chụp dữ liệu khi chạy tác vụ; sau sửa/xóa cần yêu cầu xuất mới. `EXPORT_TTL_HOURS=24` mặc định; file hết hạn được gỡ khỏi kho tải.
- `BACKUP_INTERVAL_HOURS=24`, `BACKUP_KEEP_DAYS=7`: backup tạo ngay khi khởi động, sau đó theo chu kỳ; dùng volume `ovarian_survey_backup_data`. Xem [hướng dẫn sao lưu](BACKUP_GUIDE.md) để lấy bản sao ra máy chủ khác và khôi phục.
- Nếu đặt `DATABASE_URL` trỏ database bên ngoài Compose, cấu hình `BACKUP_PGHOST`, `BACKUP_PGPORT`, `BACKUP_PGDATABASE`, `BACKUP_PGUSER`, `BACKUP_PGPASSWORD` cho đúng database ứng dụng. Backup từ chối chạy khi có URL override nhưng thiếu host backup, để tránh sao lưu nhầm database.

Kiểm tra ngày 21/11/2026 trên PostgreSQL 16 trong Docker, 20.000 phiếu giả: gửi 200 lô qua Sheet giả HTTP, không đọc snapshot toàn bảng; gửi lại/xóa/khôi phục đúng UUID và phiên bản. Yêu cầu xuất Excel trả về khoảng 26 ms; tạo nền khoảng 20 giây, đọc lại đủ 20.000 dòng. Trong lúc xuất, trang danh sách cuối có thời gian trung vị khoảng 192 ms. Bản sao lưu từ dịch vụ backup đã khôi phục vào database khác, đủ 20.000 dòng và khớp hash mọi nội dung phiếu.

Mã Apps Script được chạy bằng bộ giả lập dịch vụ với 20.000 dòng trong bộ nhớ: cấp phát khoảng 3,7 triệu ô cho Tổng hợp/các tab bệnh viện và trạng thái kỹ thuật. Những số đo này không phải tốc độ Google Sheets thật hoặc cam kết hiệu năng trên máy chủ đích. Sau triển khai, kiểm tra một lô nhỏ trên Sheet đích trước khi đối chiếu toàn bộ dữ liệu thật.
