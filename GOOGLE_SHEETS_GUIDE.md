# Đồng bộ Google Sheets

PostgreSQL là nguồn dữ liệu chính. Backend dùng Web App để ghi phiếu và đọc lại tab `gid=0` nhằm xác minh kết quả. Sheet có thể giữ ở chế độ **Hạn chế** trong Drive.

Backend cũng tương thích với Web App cũ chỉ hỗ trợ ghi/gỡ dòng. Nếu Web App trả lỗi `appendRow()` cho yêu cầu đọc lại, backend thử đối chiếu bằng bản xuất CSV vốn đã truy cập được từ máy chủ. Kết quả vẫn phải khớp UUID và nội dung trước khi báo đồng bộ thành công. Nếu CSV yêu cầu đăng nhập, cần cập nhật Apps Script theo các bước dưới đây. Bản Apps Script mới hỗ trợ token, đọc Sheet riêng tư và cập nhật cấu trúc cột.

## Thiết lập hoặc nâng cấp Apps Script

1. Nếu đang dùng Sheet thật, tạo một bản sao dự phòng trước khi đổi mã. Mở **Tiện ích mở rộng → Apps Script** và dán toàn bộ nội dung [deploy/google_apps_script.js](deploy/google_apps_script.js).
2. Vào **Cài đặt dự án → Thuộc tính tập lệnh** để thêm `GOOGLE_SHEETS_SPREADSHEET_ID` (phần giữa `/d/` và `/edit` trong URL Sheet) và `GOOGLE_SHEETS_WEBHOOK_TOKEN` (tạo riêng bằng `openssl rand -hex 32`). Script chỉ mở bảng có ID này và tab `gid=0`.
3. Tạo Web App hoặc cập nhật deployment hiện có sang **Phiên bản mới** để giữ URL. Chọn thực thi bằng tài khoản có quyền sửa Sheet, cấp lại quyền nếu Google yêu cầu và chọn quyền truy cập Web App cho phép backend gọi URL `/exec`. Backend xác thực bằng token trong nội dung yêu cầu. Quyền Web App độc lập với quyền chia sẻ tệp Sheet. Nếu Google Workspace chặn backend gọi Web App theo cấu hình hiện có, để tích hợp tắt cho đến khi quản trị viên Workspace thiết lập quyền phù hợp.
4. Điền các giá trị tương ứng ở `.env` gốc khi dùng Docker hoặc `backend/.env` khi chạy local.

```dotenv
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec
GOOGLE_SHEETS_SPREADSHEET_ID=YOUR_SPREADSHEET_ID
GOOGLE_SHEETS_WEBHOOK_TOKEN=YOUR_RANDOM_SHARED_TOKEN
```

5. Với Docker, áp dụng cấu hình bằng `docker compose up -d --wait backend` và `docker compose restart nginx`. Xác minh trên một Sheet thử trước khi dùng với bệnh án. Giữ URL và token trong kho bí mật hoặc chuyển riêng cho người triển khai. Sau khi chuyển sang script có xác thực, kiểm tra và lưu trữ deployment Web App cũ nếu URL cũ vẫn có thể ghi mà không kiểm tra token. Có thể tắt chế độ công khai/xuất bản của Sheet cũ nếu trước đây chỉ bật để backend đọc CSV.

Apps Script mở Sheet theo ID để hoạt động ở chế độ Web App. [Tài liệu Google về giới hạn của bound scripts](https://developers.google.com/apps-script/guides/bound#special_methods).

## Kiểm tra đồng bộ

- Đăng nhập admin, mở **Quản lý biểu mẫu → Phiên bản & đồng bộ** để xem trạng thái cập nhật cột.
- Dùng **Đồng bộ Google Sheets** trong trang quản lý phiếu để đưa phiếu vào hàng đợi hoặc chạy đối chiếu. Chỉ coi đồng bộ thành công sau khi hệ thống đọc lại và xác nhận dữ liệu.
- Khi lỗi, kiểm tra đủ ba biến, token và ID có khớp với Script Properties, URL có đuôi `/exec`, Web App đang chạy phiên bản mới và tài khoản thực thi có quyền sửa Sheet. Cột ID đồng bộ nằm ở cột vật lý đầu tiên. Nếu Sheet có cột lạ hoặc trùng tên, đối chiếu cấu hình trước khi thử lại.
- Giữ cả ba biến trống khi chưa dùng Google Sheets. Dữ liệu và tính năng xuất Excel/CSV vẫn dùng PostgreSQL.
