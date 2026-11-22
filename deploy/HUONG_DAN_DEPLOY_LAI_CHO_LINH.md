# Chị Linh cập nhật website đang chạy form v3

Đã đọc lại hướng dẫn cũ `HUONG_DAN_SUA_GIAO_DIEN_FORM.md` và kiểm tra API công khai tại `https://survey.dragonvisionai.com`: form hiện là v3, có 74 câu hỏi lâm sàng và 20 lựa chọn WHO. Đây là ảnh chụp cấu hình ngày 21/11/2026, không phải bản sao bệnh án. Máy chủ có thể có thay đổi sau thời điểm kiểm tra.

Đợt này phải build lại cả ứng dụng, chạy migration và mở worker. Không áp dụng riêng lệnh `build nginx` của tài liệu cũ. Hai sửa giao diện mới gồm mũi tên lên/xuống và tự mở/cuộn/đặt con trỏ vào mục bắt buộc còn thiếu khi gửi; lưu nháp vẫn cho phép chưa đủ thông tin.

## 1. Sao lưu bản đang chạy trước khi kéo mã mới

Chạy trong thư mục checkout đang có `docker-compose.yml` và `.env` thật. Giữ nguyên tên project Compose, volume, mật khẩu PostgreSQL, SECRET_KEY, tài khoản admin và ba biến kết nối Sheets. Không chép `.env.example` đè lên `.env`.

```bash
set -euo pipefail
umask 077
git status --short
git rev-parse HEAD
docker compose ps
bash scripts/backup_db.sh
mkdir -p backups
git rev-parse HEAD > backups/checkout-truoc-cap-nhat.txt
curl -fsS https://survey.dragonvisionai.com/api/v1/forms/current > backups/form-truoc-cap-nhat.json
```

Nếu checkout có sửa mã nguồn, giữ lại và đối chiếu trước khi pull. `.env` và các file sao lưu được bỏ qua bởi Git, không cần xóa. Nếu sao lưu lỗi, xử lý lỗi trước khi tiếp tục. Script sao lưu mới chặn trường hợp ứng dụng dùng database bên ngoài nhưng lại sao lưu PostgreSQL trong Compose.

## 2. Lấy mã và triển khai đầy đủ

```bash
git pull --ff-only origin main
docker compose config --quiet
bash scripts/deploy.sh
```

`deploy.sh` build hai image, kiểm tra kết nối/cấu hình bằng image mới khi bản cũ vẫn phục vụ, sao lưu database, giữ tag ảnh container cũ, rồi mới dừng API/Nginx/worker trong lúc migration. Nó chạy Alembic đến `010_search_indexes`, khởi tạo phần còn thiếu và mở đủ năm dịch vụ. Nếu lỗi, script trả mã lỗi và ghi hướng dẫn giữ lại dữ liệu để xử lý; không tự xóa volume hoặc tự gán phiên bản migration.

Migration tìm kiếm cần extension PostgreSQL `pg_trgm`. Nếu preflight báo thiếu quyền, nhờ người quản trị database cài `CREATE EXTENSION IF NOT EXISTS pg_trgm;` vào đúng database, rồi chạy lại bước này. Không bỏ qua migration bằng `alembic stamp head`.

Các biến mới đã có giá trị mặc định: `SHEETS_SYNC_BATCH_SIZE=100`, `EXPORT_TTL_HOURS=24`, `BACKUP_INTERVAL_HOURS=24`, `BACKUP_KEEP_DAYS=7`. Nếu có `DATABASE_URL` trỏ ra ngoài Compose, cấu hình đúng nhóm `BACKUP_PG*` theo `.env.example` và thực hiện sao lưu ngoài Compose theo hạ tầng của đơn vị; không dùng bản sao từ một database khác.

## 3. Giữ cấu hình câu hỏi v3 của máy chủ

Không chạy `import_form ...managed-v5.json --force`, không chạy lại bản vá WHO và không xuất bản lại form chỉ để cập nhật frontend. Mã `custom_eb7f5f353789` của câu Số lượng u tiếp tục thuộc cấu hình của máy chủ. Phiếu đã tạo giữ phiên bản đã nhập. Script khởi tạo mặc định giữ lại các phiên bản hiện có và không thay mật khẩu admin cũ.

Form v3 hiện chưa có sáu câu Có/Không và mô tả mới của phẫu thuật trong cấu hình riêng. Nếu muốn bổ sung chúng, admin thực hiện trong Quản lý biểu mẫu sau khi nâng cấp; kiểm tra trước khi xuất bản. Không thêm Số lượng u (Phẫu thuật) lần nữa khi câu Số lượng u tùy chỉnh đang có cùng ý nghĩa và lựa chọn. Nâng mã nguồn không tự thay danh sách câu hỏi đã xuất bản của bệnh viện.

## 4. Cập nhật Apps Script và xác minh

Giữ nguyên Spreadsheet ID, token và URL Web App đang dùng. Thay mã bằng `deploy/google_apps_script.js`, rồi vào **Deploy → Manage deployments → Edit → New version → Deploy**. Không dùng URL `/dev`. Bản mới có `batch_version: 1`, `layout_version: 2`; backend vẫn tương thích script cũ trong lúc cập nhật, nhưng hiệu năng theo lô cần bản mới.

Đăng nhập admin, vào Quản lý biểu mẫu → Phiên bản & đồng bộ → Thử lại đồng bộ cột. Đợi xác minh cấu trúc thành công. Không dọn các dòng cũ trên Sheet chỉ vì chúng không có trong database local; đối chiếu với database máy chủ và chỉ xác nhận dọn khi đúng.

Nút thử lại cũng xếp các phiếu đã gửi và các tác vụ gỡ phiếu vào hàng đợi để bổ sung dữ liệu vào cột vừa sửa. Theo dõi trạng thái từng phiếu; lưu nháp không được đẩy lên Sheet.

```bash
bash scripts/healthcheck.sh
docker compose ps
curl -fsS https://survey.dragonvisionai.com/health/ready
docker compose logs --tail=50 backend worker backup
```

Kết quả sẵn sàng phải có `schema_revision: 010_search_indexes`. `worker` và `backup` phải healthy. Nếu worker chưa chạy, Excel sẽ nằm ở trạng thái chờ và Sheet chưa được cập nhật, dù trang chủ vẫn mở được.

Cuối cùng Ctrl+F5, đăng nhập bằng tài khoản cũ, kiểm tra v3/câu tùy chỉnh/WHO 20 lựa chọn còn đúng; mở một phiếu cũ và xuất Excel mới để kiểm tra tải file. Trên môi trường thử, kiểm tra nút lên/xuống, gửi thiếu mục bắt buộc, lưu nháp, xóa/khôi phục và Sheet. Không dùng bệnh án thật để thử xóa.

## 5. Kết quả diễn tập trước bàn giao

Ngày 21/11/2026 đã chạy Docker Compose trên database PostgreSQL 16 riêng với cấu hình form v3 công khai và ba phiếu giả, nâng từ migration `007_ultrasound_conclusion` lên `010_search_indexes`. Đối chiếu toàn bộ cấu hình form, câu trả lời, phiên bản phiếu, mã phiếu, hash mật khẩu admin và bộ đếm mã phiếu đều khớp; phiên đăng nhập cũ vẫn hợp lệ. Đã khôi phục backup schema cũ rồi chạy lại chính `scripts/deploy.sh` thành công.

API, worker, backup, frontend và asset build đều qua kiểm tra. Trình duyệt Chrome tải được Excel từ worker, giữ câu Số lượng u tùy chỉnh, hiện đủ mũi tên, đưa con trỏ tới mục bắt buộc và không tràn ngang ở chiều rộng 375 px. Bộ kiểm thử backend hiện đạt 233 test; frontend build và hai bộ kiểm thử Apps Script đạt.

Lần kiểm tra đồng bộ cuối đã bổ sung trường hợp xuất bản form hoặc bấm thử lại khi phiếu đang được gửi. Phiếu đang chạy giữ lượt gửi hiện tại rồi tự vào hàng đợi lại, tránh bỏ sót cột mới hoặc mất yêu cầu thử lại. Bốn tình huống này đạt trên PostgreSQL 16 với đích Sheet giả, cho cả đồng bộ theo lô và luồng Script cũ. Sửa này không cần migration mới hoặc thay database.

Ngày 22/11/2026 bổ sung xuất Excel có tab Tổng hợp và năm tab bệnh viện giống Google Sheets. Đã kiểm tra luồng xuất trực tiếp/hàng đợi, giữ số 0 đầu, lọc phiếu hủy/thùng rác và mở file mẫu trong Microsoft Excel. Bài thử 20.000 phiếu giả có đủ 20.000 dòng Tổng hợp và 4.000 dòng mỗi bệnh viện. Sau cập nhật backend/worker, chọn **Xuất Excel mới**; file cũ không tự thêm tab. Phần này giữ database hiện có và không cần migration mới.

Đây là diễn tập bằng dữ liệu giả, chưa triển khai lên máy chủ của chị Linh. Chưa thực hiện ghi/xóa trên Google Sheet thật; cần cập nhật Web App và kiểm tra kết nối trên máy chủ theo bước 4.

## Khi một bước thất bại

Nếu tất cả container đã **Healthy**, schema là `010_search_indexes` nhưng cuối log có `curl: (3) URL rejected: Malformed input to a URL function`, cập nhật script kiểm tra rồi chạy lại:

```bash
git pull --ff-only origin main
bash scripts/healthcheck.sh
```

Bản sửa xử lý Docker trả nhiều dòng IPv4/IPv6 thay vì ghép cả hai vào URL. Riêng lỗi này không cần build lại hay chạy lại migration. Cảnh báo `schema_json ... shadows ... BaseModel` không phải nguyên nhân `curl (3)`. Nếu kiểm tra sau đó báo lỗi khác, xử lý theo lỗi mới trước khi kết luận triển khai hoàn tất.

Nếu lỗi ở preflight/build, bản cũ vẫn đang chạy. Nếu lỗi sau khi dừng để migration, giữ nguyên database, `.env`, toàn bộ volume và thư mục `backups`. Xem [hướng dẫn xử lý nâng cấp lỗi](../UPDATE_GUIDE.md). Có tag ảnh cũ trong `backups/deploy-*/backend-image.txt` và `nginx-image.txt`; không mở ảnh cũ với database đã thay đổi khi chưa đối chiếu migration. Sao lưu ở cùng máy chủ cần được chép thêm sang nơi lưu trữ khác.
