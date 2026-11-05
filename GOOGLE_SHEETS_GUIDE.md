# Đồng bộ Google Sheets

Database là nơi lưu phiếu chính. Webhook bổ sung phiếu mới vào Sheet; nút **Đồng bộ lại Sheet** đối chiếu mã phiếu và bổ sung những phiếu còn thiếu.

## Thiết lập

1. Mở Sheet đích, chọn **Tiện ích mở rộng → Apps Script**.
2. Dùng mã nguồn trong [deploy/google_apps_script.js](deploy/google_apps_script.js), tránh sao chép lại bản mã cũ từ tài liệu.
3. Triển khai dưới dạng ứng dụng web với quyền thực thi và truy cập phù hợp cho backend. Lưu URL `/exec` trong cấu hình local.
4. Cấu hình `backend/.env` khi chạy local; Docker đọc các biến từ `.env` ở gốc:

```dotenv
GOOGLE_SHEETS_WEBHOOK_URL=https://script.google.com/macros/s/your_deployment_id/exec
GOOGLE_SHEETS_SPREADSHEET_ID=your_spreadsheet_id
```

Spreadsheet ID là phần giữa `/d/` và `/edit` trong URL bảng tính. Phần đối chiếu đọc bản xuất CSV của trang `gid=0`; endpoint phải truy cập được từ backend. Ứng dụng không tự thay đổi quyền chia sẻ Sheet. Không đưa URL webhook thật hoặc dữ liệu bệnh án vào Git.

Khởi động lại backend sau khi đổi cấu hình. Nếu thay mã Apps Script, cập nhật bản triển khai đang được URL webhook sử dụng.

## Đối chiếu phiếu

Nút **Đồng bộ lại Sheet** thực hiện:

1. Đọc các UUID đã có trên Sheet và kiểm tra cấu trúc cột.
2. Lấy phiếu ở tất cả phiên bản biểu mẫu đang có trong database.
3. Gửi riêng những UUID còn thiếu; giữ các dòng đã có.
4. Đọc lại Sheet, kiểm tra mã thiếu, mã thừa và dòng trùng.

Chỉ khi bước đọc lại khớp database, API mới trả `verified: true` và số phiếu thực tế. HTTP 200 từ Apps Script kèm JSON lỗi vẫn được coi là lỗi. Nếu một lượt gửi bị gián đoạn, có thể đối chiếu lại để bổ sung phần còn thiếu.

Phiếu mới được gửi nền sau khi lưu database. Việc gửi nền có thể thất bại khi mạng hoặc Apps Script không sẵn sàng; dùng chức năng đối chiếu để phục hồi. Khóa đồng bộ hiện nằm trong từng tiến trình backend, không phải khóa dùng chung giữa nhiều worker.

## Khi có lỗi

- **Không đọc được Sheet:** kiểm tra Spreadsheet ID, `gid=0` và quyền đọc CSV hiện có.
- **Cấu trúc cột khác:** so sánh tiêu đề với CSV xuất từ admin trước khi tiếp tục.
- **Mã thừa hoặc dòng trùng:** kiểm tra các dòng được báo; luồng đối chiếu không tự xóa chúng.
- **Apps Script chưa xác nhận thao tác:** kiểm tra bản triển khai và JSON trả về; không chỉ dựa vào mã HTTP.

Mã Apps Script định dạng cột Số HS và PARA dạng text để giữ các số 0 ở đầu. Xuất CSV cũng giữ PARA dưới dạng chuỗi.
