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

5. Với Docker, áp dụng cấu hình bằng `docker compose up -d --wait backend worker` và `docker compose restart nginx`. Xác minh trên một Sheet thử trước khi dùng với bệnh án. Giữ URL và token trong kho bí mật hoặc chuyển riêng cho người triển khai. Sau khi chuyển sang script có xác thực, kiểm tra và lưu trữ deployment Web App cũ nếu URL cũ vẫn có thể ghi mà không kiểm tra token. Có thể tắt chế độ công khai/xuất bản của Sheet cũ nếu trước đây chỉ bật để backend đọc CSV.

Apps Script mở Sheet theo ID để hoạt động ở chế độ Web App. [Tài liệu Google về giới hạn của bound scripts](https://developers.google.com/apps-script/guides/bound#special_methods).

## Kiểm tra đồng bộ

- Đăng nhập admin, mở **Quản lý biểu mẫu → Phiên bản & đồng bộ** để xem trạng thái cập nhật cột.
- Dùng **Đồng bộ Google Sheets** trong trang quản lý phiếu để đưa phiếu vào hàng đợi hoặc chạy đối chiếu. Chỉ coi đồng bộ thành công sau khi hệ thống đọc lại và xác nhận dữ liệu.
- Khi lỗi, kiểm tra đủ ba biến, token và ID có khớp với Script Properties, URL có đuôi `/exec`, Web App đang chạy phiên bản mới và tài khoản thực thi có quyền sửa Sheet. Cột ID đồng bộ nằm ở cột vật lý đầu tiên. Nếu Sheet có cột lạ hoặc trùng tên, đối chiếu cấu hình trước khi thử lại.
- Giữ cả ba biến trống khi chưa dùng Google Sheets. Dữ liệu và tính năng xuất Excel/CSV vẫn dùng PostgreSQL.

## Khi sửa câu hỏi rồi đồng bộ báo lệch cột

Kiểm tra phiên bản biểu mẫu đang công bố ở đúng database của backend. Nếu Sheet đã có cột câu hỏi tùy chỉnh nhưng database chỉ còn bản biểu mẫu cũ, cần khôi phục định nghĩa câu hỏi theo đúng mã trường từ bản sao lưu rồi xuất bản phiên bản mới. Không xóa cột hoặc gán cột đó cho câu hỏi khác để làm mất thông báo lỗi. Phiếu cũ tiếp tục giữ phiên bản đã nhập.

Hai cột dịch nang MRI T1W/T2W được nhận diện cả khi database chưa xuất bản biểu mẫu quản lý. Sau khi xác minh cấu trúc cột thành công, hàng đợi tự cho các phiếu đã hết lượt thử do lỗi trước đó chạy lại, kể cả thao tác gỡ phiếu đã hủy hoặc đưa vào thùng rác.

## Xóa phiếu và dọn dòng cũ

- Xóa phiếu trên web chuyển phiếu vào thùng rác, loại khỏi Excel/CSV tải mới và xếp hàng gỡ UUID tương ứng khỏi Sheet. Yêu cầu gỡ được ưu tiên và không phụ thuộc vào việc đồng bộ cấu trúc cột. Giao diện chỉ báo đã gỡ sau khi đọc lại Sheet xác nhận không còn UUID đó.
- Phiếu trong thùng rác có thể khôi phục; nếu trạng thái trước khi xóa là đã gửi, phiếu được đưa trở lại Sheet và dữ liệu xuất.
- Dòng trên Sheet không thuộc database hiện tại được báo khi bấm **Đồng bộ lại**. Chọn **Dọn N dòng cũ** và xác nhận để lưu toàn bộ các dòng đó vào database trước khi gỡ. Có thể **Tải bản sao lưu** ở bảng tiến độ. Chức năng này chỉ dành cho tài khoản quản lý.
- Việc dọn dùng bản đối chiếu vừa xem, có hàng đợi bền vững và xác minh sau xóa. Nếu dòng được sửa hoặc phiếu được nhập lại sau khi đối chiếu, hệ thống dừng để đối chiếu lại hoặc giữ phiếu hiện có. Dòng mới không nằm trong bản đối chiếu không bị dọn.
- Excel/CSV đã tải về không tự cập nhật. Sau khi xóa, bấm **Xuất Excel mới** để tải lại. File xuất từ ứng dụng chỉ lấy các phiếu còn thuộc dữ liệu xuất trong database.

## Tổng hợp và tab từng bệnh viện

Tab dữ liệu chính vẫn có `gid=0`, tên hiển thị **Tổng hợp**. Các tab **TD - Từ Dũ**, **HV - Hùng Vương**, **YD - ĐH Y Dược**, **GD - Gia Định**, **UB - Ung Bướu CS2** tự lọc dữ liệu theo **Mã bệnh viện**; không duy trì các bản sao bệnh án riêng. Công thức giữ nguyên kiểu dữ liệu, gồm tiêu đề khi chưa có phiếu và tự theo số hàng/cột của Tổng hợp. Với locale `vi_VN`, công thức dùng dấu `;` để tránh lỗi phân tích cú pháp.

Khi triển khai Apps Script mới, backend sẽ yêu cầu bố cục nhóm và tạo các tab cần thiết ngay cả khi bộ tên cột đã khớp. Chỉ tab có developer metadata `GG_FORM_WHO_HOSPITAL` đúng mã bệnh viện mới được cập nhật; không ghi đè tab người dùng tự tạo trùng tên. Backend vẫn đồng bộ dữ liệu với script cũ, nhưng cần cập nhật deployment để duy trì bố cục và vùng hiển thị các tab khi cấu hình thay đổi về sau.

## Đồng bộ dữ liệu lớn

Web App mới trả `batch_version: 1`, `layout_version: 2` trong thao tác `capabilities`. Worker gửi tối đa 100 phiếu/lô theo cấu hình mặc định, giới hạn kích thước khoảng 1,5 MB. Tác vụ chỉ đọc tiêu đề cột, cột UUID, trạng thái phiên bản và các dòng vừa cập nhật để xác minh; không tải toàn bộ 84 cột cho từng phiếu. Sửa phiếu cập nhật tại dòng mang đúng UUID; phiếu trùng UUID được thu về một dòng. Gỡ/khôi phục cũng qua hàng đợi phiên bản.

Tab kỹ thuật **__GG_FORM_SYNC** được ẩn, chứa UUID, phiên bản phiếu, phiên bản cấu trúc và dấu kiểm nội dung. Nó giữ thông tin phiếu đã gỡ để chặn yêu cầu cũ đến chậm làm sống lại dữ liệu. Không sửa/xóa tab này khi hệ thống đang đồng bộ. Nếu lỗi giữa chừng, cùng phiên bản được phép gửi lại để sửa và đọc lại; worker chỉ xác nhận sau khi số dòng/nội dung khớp.

Các tab bệnh viện dùng đúng số cột đang xuất và cấp hàng theo lượng phiếu của từng bệnh viện, có phần dự phòng nhỏ. Phần lưới trống cũ được thu gọn; ô đang có giá trị ngoài phần quản lý được giữ lại. Công thức vẫn dùng FILTER để giữ nguyên kiểu dữ liệu và số 0 đầu mã.

Script cũ tiếp tục hoạt động bằng đường tương thích từng phiếu. Để có hiệu năng dữ liệu lớn, phải sao chép mã `deploy/google_apps_script.js` và **Deploy → Manage deployments → Edit → New version → Deploy**, giữ nguyên Spreadsheet ID/token rồi thử đồng bộ cột. Không thay bằng URL `/dev`.
