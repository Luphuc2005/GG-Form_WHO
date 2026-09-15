# WHO Ovarian Tumor Pathology Survey Web System
### Hệ thống Khảo sát Giải phẫu bệnh U buồng trứng theo WHO

Hệ thống ứng dụng web chuyên dụng thay thế Google Forms, phục vụ nghiên cứu và khảo sát y khoa chuyên môn về **Phân loại giải phẫu bệnh của U buồng trứng theo WHO**.

Hệ thống được thiết kế với kiến trúc **Client-Driven Form Engine** và **Stateless Backend**, đáp ứng dung lượng lưu trữ `>= 1.000.000 submissions` mà không làm quá tải tài nguyên máy chủ.

---

## 🌟 ĐẶC ĐIỂM NỔI BẬT

1. **UX Thân quen tương tự Google Forms**:
   - Giao diện dạng thẻ trắng tinh giản trên nền tím nhạt, căn giữa màn hình (tối đa 760px), tối ưu hiển thị trên Desktop, Tablet và Smartphone (375px - 1440px).
   - Tương tác chạm thân thiện với vùng bấm tối thiểu 44px trên thiết bị di động.

2. **Cơ chế Cha - Con Động Tức thì (In-Place Tree Branching)**:
   - Khi chưa chọn cha: Các lựa chọn con hoàn toàn không hiển thị.
   - Khi chọn cha: Các lựa chọn con xuất hiện **ngay bên dưới** với hiệu ứng trượt êm ái, thụt lề 28px rõ ràng kèm đường dẫn phân cấp trực quan. Không cuộn trang, không reload, không chuyển section.
   - Khi bỏ chọn cha: Toàn bộ cây con đệ quy biến mất ngay lập tức và toàn bộ giá trị đã chọn trước đó của các nút con được xóa sạch.
   - Khi chọn mục "Khác": Ô nhập văn bản "Vui lòng ghi rõ" hiển thị ngay bên dưới; bỏ chọn sẽ tự động xóa nội dung.

3. **Toàn bộ Logic biểu mẫu xử lý ở Client (Zero API Spamming)**:
   - Trình duyệt nạp JSON Schema đúng 1 lần khi mở trang.
   - Toàn bộ thao tác tick/untick, ẩn/hiện, clear đệ quy chạy 100% bằng JavaScript nội bộ tại trình duyệt, **không gửi bất kỳ request API nào lên server khi bấm checkbox**.
   - Chỉ gửi 1 request duy nhất khi người dùng nhấn nút **[Gửi]**.

4. **Kiểm soát Dữ liệu Y khoa & An toàn Phiên**:
   - Bản nháp được lưu trong `sessionStorage` (khóa `survey-draft:v1`) giúp người dùng không mất dữ liệu nếu lỡ tay F5 trong phiên làm việc.
   - Khi gửi thành công: Tự động xóa sạch bản nháp và hiển thị mã phiếu đối soát (ví dụ: `MÃ PHIẾU: 7V3K-91...`).

5. **Đảm bảo Tính Toàn vẹn & Idempotency (Chống Trùng lặp)**:
   - Trình duyệt tự sinh UUIDv4 (`crypto.randomUUID()`) cho mỗi lần nộp.
   - Backend tính mã băm SHA-256 từ payload đã chuẩn hóa (canonical JSON).
   - Nếu xảy ra timeout mạng và người dùng gửi lại cùng UUID: Hệ thống không tạo bản ghi mới mà trả về kết quả thành công hiện có; nếu gửi cùng UUID nhưng sửa nội dung answers, backend sẽ báo lỗi `409 IDEMPOTENCY_CONFLICT`.

6. **Xuất Dữ liệu Khảo sát Định dạng Rộng (Wide-Format Streaming CSV)**:
   - Định dạng CSV với mỗi lựa chọn bệnh và lựa chọn con là 1 cột nhị phân (0/1) thuận tiện cho phân tích thống kê y học (SPSS, R, Python).
   - Truy vấn dạng con trỏ luồng (`yield_per(1000)`), có tiền tố UTF-8 BOM (`\ufeff`) giúp Microsoft Excel mở trực tiếp hiển thị trọn vẹn dấu tiếng Việt mà không bao giờ gây tràn RAM máy chủ.

---

## 🏗️ KIẾN TRÚC CÔNG NGHỆ

```
Browser Client (React 18 + TypeScript + Vite)
       │
       │ (100% logic cha-con tại client)
       ▼
     Nginx (Cổng 80/443 hoặc 8080 - Nén Gzip, Cache tĩnh, Rate-limiting)
       │
       ├─► Phục vụ Static SPA (index.html, assets băm)
       │
       └─► /api/v1/submissions (Chỉ gọi khi nhấn GỬI)
             │
             ▼
         FastAPI (Python 3.12+, Uvicorn đa luồng, Pydantic v2)
             │
             ▼
      PostgreSQL 16 (Hybrid Relational + JSONB, Volume độc lập)
```

---

## 🚀 KHỞI ĐỘNG NHANH CHO LẬP TRÌNH VIÊN (DEVELOPMENT)

### 1. Chuẩn bị môi trường
Yêu cầu máy tính đã cài:
- Python 3.12+
- Node.js 20+ và npm
- Docker (nếu muốn chạy qua Docker)

### 2. Thiết lập Backend
```bash
# Di chuyển vào thư mục backend
cd backend

# Cài đặt thư viện phát triển
pip install -e ".[dev]"

# Khởi chạy backend với hot-reload
uvicorn app.main:app --reload --port 8000
```
- API Docs: `http://localhost:8000/docs`
- Healthcheck: `http://localhost:8000/health/ready`

### 3. Thiết lập Frontend
```bash
# Di chuyển vào thư mục frontend
cd frontend

# Cài đặt dependencies
npm install

# Khởi chạy Vite Dev Server
npm run dev
```
- Truy cập Survey: `http://localhost:5173/`
- Truy cập Admin: `http://localhost:5173/admin`

---

## 🚢 KHỞI ĐỘNG NHANH CHO TRIỂN KHAI MÁY CHỦ (PRODUCTION)

Chỉ với 1 dòng lệnh bằng script tự động hóa:

```bash
# 1. Sao chép cấu hình mẫu
cp .env.example .env

# 2. Chỉnh sửa mật khẩu và tên miền
nano .env

# 3. Chạy script kiểm tra cấu hình máy chủ (Read-only)
./scripts/check_server.sh

# 4. Triển khai toàn diện hệ thống
sudo ./scripts/deploy.sh
```

Chi tiết bàn giao cho giảng viên và quản trị viên máy chủ vui lòng đọc [DEPLOYMENT_FOR_TEACHER.md](file:///d:/HocTap/Form-GG/DEPLOYMENT_FOR_TEACHER.md).

---

## 🧪 KIỂM THỬ (TESTING)

Chạy bộ 14 bài kiểm thử tích hợp backend:
```bash
pytest backend/tests -v
```

Kiểm tra tải hệ thống bằng Locust:
```bash
locust -f loadtest/locustfile.py --host http://localhost:8080
```
Chi tiết cấu hình tài nguyên và tối ưu hóa hiệu năng xem tại [PERF.md](file:///d:/HocTap/Form-GG/PERF.md).
