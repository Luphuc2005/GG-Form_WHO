# Cập nhật danh mục WHO 20 lựa chọn

Bản vá xử lý trường hợp web đã có giao diện mới nhưng API vẫn trả 15 lựa chọn WHO cũ. Danh mục nằm trong database. Lệnh `import_form ...v1.json` giữ lại v1 khi đã có phiếu, nên chạy migration và restart backend chưa cập nhật được danh mục.

Tài khoản admin hiện có tiếp tục sử dụng được. Lệnh `create_admin` chỉ cần khi khởi tạo tài khoản. Bản vá đọc danh mục 20 mục từ file JSON trong repository, sao chép biểu mẫu hiện hành và xuất bản thành phiên bản tiếp theo. Các câu hỏi lâm sàng đang cấu hình được đưa vào phiên bản mới cùng danh mục này.

## Chạy trên máy chủ

Thực hiện trong thư mục checkout có `docker-compose.yml`, với backend và PostgreSQL đang chạy. Các lệnh dưới đây sao chép hai file vào container backend hiện có.

### 1. Lấy bản vá và sao lưu

```bash
set -e
git pull --ff-only origin main
bash scripts/backup_db.sh
```

Kiểm tra lệnh sao lưu thành công trước khi tiếp tục.

### 2. Sao chép bản vá và danh mục từ checkout

```bash
docker compose cp deploy/fix_who_catalog.py backend:/tmp/fix_who_catalog.py
docker compose cp form-definitions/ovarian-pathology-v1.json backend:/tmp/who-catalog-20.json
```

### 3. Xem kết quả dự kiến

```bash
docker compose exec -T backend python /tmp/fix_who_catalog.py --definition /tmp/who-catalog-20.json
```

Với trường hợp đang gặp, kết quả có `current_options: 15`, `target_options: 20` và `status: "preview"`. Lệnh này chỉ đọc database.

### 4. Xuất bản danh mục mới

```bash
docker compose exec -T backend python /tmp/fix_who_catalog.py --definition /tmp/who-catalog-20.json --apply
```

Kết quả có `status: "published"` và `published_version`. Nếu biểu mẫu hiện hành là v1, bản mới thường là v2. Nếu có các phiên bản khác, script cấp số tiếp theo. Chạy lại khi đã đúng 20 mục trả `status: "already_current"`.

### 5. Kiểm tra API và giao diện

```bash
curl -fsS https://survey.dragonvisionai.com/api/v1/forms/current +  | docker compose exec -T backend python -c 'import json,sys; d=json.load(sys.stdin); f=next(f for f in d["schema_json"]["fields"] if f["id"]=="pathology"); print("version =",d["version"],"WHO options =",len(f["options"])); assert len(f["options"])==20'
```

Mở một tab mới và nhập địa chỉ website để tạo phiên nhập mới. Kiểm tra WHO 1 và WHO 2 đều có 20 lựa chọn, gồm tên tiếng Anh và mã ICD-O như local.

Phiếu đã tạo trước đó tiếp tục gắn với danh mục của phiên bản đã nhập. Một tab đang giữ bản nháp v1 có thể tiếp tục hiển thị 15 lựa chọn. Việc mở phiếu mới dùng danh mục mới. Lịch sử phiếu và định danh bệnh án được giữ trong database.

Bản vá chỉ thay danh mục WHO cho phiên bản biểu mẫu mới. Đồng bộ Google Sheets tiếp tục dùng cấu hình kết nối đang có.
