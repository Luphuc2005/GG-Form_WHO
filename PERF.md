# Performance Tuning & Capacity Guide
### Khả năng chịu tải và Điều chỉnh Hiệu năng cho >= 1.000.000 Submissions

Tài liệu hướng dẫn tối ưu hóa tài nguyên máy chủ và kiểm thử tải hiệu năng thực tế.

---

## 1. NGUYÊN LÝ THIẾT KẾ CHO QUY MÔ LỚN

Hệ thống được thiết kế để xử lý và lưu trữ **>= 1.000.000 lượt phản hồi tổng cộng**:
1. **Phần lớn tải là Tĩnh (Static)**: Trình duyệt chỉ tải mã nguồn HTML/JS/CSS và JSON schema 1 lần duy nhất. Toàn bộ logic hiển thị, ẩn lựa chọn, đệ quy xóa trạng thái con chạy cục bộ trên RAM của thiết bị người dùng.
2. **Endpoint Submit Tinh gọn (Lean API)**: `POST /api/v1/submissions` không thực hiện bất kỳ tác vụ nặng nào (không sinh file Excel, không tính toán thống kê tức thời). Chu trình gói gọn trong:
   - Tiếp nhận -> Kiểm tra SHA-256 Idempotency -> Xác thực Schema -> Ghi bản ghi vào PostgreSQL -> Phản hồi HTTP 201.
   Thời gian xử lý trung bình: `< 15ms` cho mỗi request.
3. **Không bao giờ cạn kiệt RAM khi Xuất dữ liệu**: Xuất CSV sử dụng Server-side cursor `yield_per(1000)` luân phiên đọc và gửi trực tiếp ra luồng mạng, đảm bảo RAM backend chỉ tiêu thụ dưới `150MB` kể cả khi xuất toàn bộ 1.000.000 bản ghi.

---

## 2. ĐIỀU CHỈNH THÔNG SỐ THEO PHẦN CỨNG THẬT (CPU & RAM)

Trong tệp `.env`, hai nhóm thông số quan trọng nhất cần tinh chỉnh là:
- `WEB_CONCURRENCY`: Số tiến trình Uvicorn worker xử lý song song.
- `DB_POOL_SIZE` & `DB_MAX_OVERFLOW`: Kích thước pool kết nối cơ sở dữ liệu.

### Công thức tính toán khuyến nghị:

| Cấu hình Máy chủ | WEB_CONCURRENCY | DB_POOL_SIZE | DB_MAX_OVERFLOW | Tổng kết nối DB tối đa |
| :--- | :---: | :---: | :---: | :---: |
| **Nhỏ (2 vCPU, 2 GB RAM)** | 2 | 5 | 5 | 2 * 10 = 20 |
| **Tiêu chuẩn (4 vCPU, 4-8 GB RAM)** | 4 | 10 | 10 | 4 * 20 = 80 |
| **Lớn (8 vCPU, 16 GB RAM)** | 8 | 15 | 10 | 8 * 25 = 200 |

> **CẢNH BÁO QUAN TRỌNG:**
> PostgreSQL có giới hạn mặc định `max_connections = 100`.
> Phải luôn đảm bảo: `WEB_CONCURRENCY * (DB_POOL_SIZE + DB_MAX_OVERFLOW) < max_connections` để tránh lỗi *"sorry, too many clients already"*.

---

## 3. KIỂM THỬ TẢI VỚI LOCUST (LOAD TESTING)

Tệp kiểm thử tải chuyên dụng đã được định nghĩa tại `loadtest/locustfile.py`.

### Cài đặt Locust:
```bash
pip install locust
```

### Chạy kiểm thử tải:
```bash
# Khởi chạy giao diện web của Locust
locust -f loadtest/locustfile.py --host http://localhost:8080
```
Mở trình duyệt tại `http://localhost:8089` để cấu hình số lượng người dùng đồng thời.

### Các mốc thử nghiệm đề xuất:
1. **100 Người dùng Đồng thời (Concurrent Users)**:
   - Mục tiêu: Kiểm tra độ ổn định và đo lường baseline latency.
   - Kỳ vọng: `p50 < 20ms`, `p95 < 50ms`, `Error Rate = 0%`.
2. **500 Người dùng Đồng thời**:
   - Mục tiêu: Mô phỏng lưu lượng cao điểm khi toàn trường mở đợt khảo sát tập trung.
   - Kỳ vọng: Thông lượng `>= 200 req/s`, `p95 < 150ms`, `Error Rate = 0%`.
3. **1.000 Người dùng Đồng thời**:
   - Mục tiêu: Thử nghiệm giới hạn máy chủ.
   - Quan sát mức sử dụng CPU và bộ nhớ của Nginx, Uvicorn và PostgreSQL.

### Các chỉ số cần ghi nhận:
- **Requests/sec (RPS)**: Số yêu cầu nộp phiếu được xử lý thành công mỗi giây.
- **p50 (Median)**: Thời gian xử lý cho 50% người dùng nhanh nhất.
- **p95**: Thời gian xử lý cho 95% người dùng.
- **p99**: Độ trễ cao nhất của 1% người dùng cuối.
- **Failures (%)**: Tỷ lệ lỗi (Bắt buộc phải bằng 0% đối với các request hợp lệ).
