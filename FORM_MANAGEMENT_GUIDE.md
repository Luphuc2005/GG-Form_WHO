# Quản lý biểu mẫu sau khi triển khai

## Cách dùng

Đăng nhập bằng tài khoản có vai trò **admin**, mở **Quản lý biểu mẫu** ở thanh công cụ hoặc `/admin/form-builder`. Bác sĩ vẫn xem/sửa bệnh án; chỉ admin được thay cấu trúc thu thập dữ liệu.

1. Chọn câu hỏi để đổi tên, hướng dẫn, nhóm hiển thị, danh sách lựa chọn, yêu cầu bắt buộc hoặc bật/tắt cột xuất. **Thêm câu hỏi** hỗ trợ văn bản ngắn/dài, số, ngày, chọn một và chọn nhiều.
2. Mã câu hỏi được cấp tự động, giữ nguyên qua các lần đổi tên. Câu hỏi đã công bố giữ nguyên kiểu dữ liệu; muốn đổi kiểu, tạo câu hỏi mới và ngừng dùng câu cũ.
3. **Lưu nháp** lưu cấu hình trên máy chủ, không thay form đang dùng. Bản nháp được chia sẻ giữa các admin; nếu người khác sửa/xuất bản trước, hệ thống báo xung đột thay vì ghi đè.
4. **Kiểm tra & xem trước** kiểm tra cấu hình, liệt kê thay đổi, hiển thị bộ cột xuất và cho nhập thử trên form. Bản xem trước không tạo bệnh án.
5. **Xuất bản phiên bản mới** áp dụng cho phiếu được tạo sau đó. Phiếu đã tạo, kể cả nháp đang nhập, tiếp tục sử dụng phiên bản đã gắn với phiếu.
6. Tab **Phiên bản & đồng bộ** hiển thị lịch sử và trạng thái cập nhật cột Sheet. **Sao chép để tạo phiên bản mới** lấy cấu hình từ một bản trước để chỉnh và xuất bản lại, không viết lại lịch sử.

Danh mục GPB WHO có tab riêng: thêm/sửa tên, mã ICD-O, phân loại và lựa chọn ghi nội dung khác. Bỏ một chẩn đoán khỏi phiên bản mới không xóa chẩn đoán trên phiếu cũ. Các quy tắc chuyên môn của trường có sẵn, định danh bệnh viện và mã nghiên cứu vẫn do hệ thống kiểm tra. Sáu trường IOTA phải được bật/ngừng dùng cùng nhau để giữ quy tắc tổng tỷ lệ.

Form có hai ô kết quả GPB: **WHO 1** là kết quả chính bắt buộc, **WHO 2** không bắt buộc. Mỗi ô có mã ICD-O, bản chất u và nội dung Khác riêng. Kết quả cũ được đọc thành WHO 1; WHO 2 để trống. Phân loại chính phục vụ thống kê lấy từ WHO 1, không tự suy diễn từ WHO 2. Sheet/Excel/CSV có hai cột tương ứng. Cột WHO gộp trên Sheet cũ được nhận diện bằng tên lịch sử khi nâng cấp cấu trúc.

## Đồng nhất dữ liệu

- Database là nguồn dữ liệu chính. Mỗi bản biểu mẫu lưu một cấu hình đầy đủ. Form nhập và trang sửa phiếu lấy đúng cấu hình của phiên bản đó; backend kiểm tra theo cùng cấu hình.
- Excel, CSV và Sheet dùng cùng bộ mã trường và tên cột hiện hành. Khi đổi tên, dữ liệu được ghép bằng mã trường và các tên lịch sử. Không tạo một cột mới chỉ vì tên câu hỏi đổi.
- Câu hỏi mới có ô trống trên phiếu cũ vì trước đó chưa thu thông tin; hệ thống không tự điền dữ liệu.
- Bỏ **Đang sử dụng trên form** để ngừng thu câu hỏi. Giữ bật **Có cột trong Google Sheets và Excel** để tiếp tục xuất dữ liệu lịch sử.
- Nếu bỏ cột xuất, cột đó bị gỡ khỏi Sheet và các file tải mới sau khi cấu trúc được đồng bộ. Dữ liệu vẫn còn trong database và lịch sử phiếu. Có thể bật lại cột và đồng bộ lại các phiếu.
- File Excel/CSV đã tải là bản chụp; phải tải lại để lấy cấu hình và dữ liệu mới. Đồng bộ Sheet là một chiều từ hệ thống. Không dùng việc sửa tay trên Sheet để cập nhật bệnh án.
- Cột có sẵn trên Sheet được giữ vị trí; cột mới được thêm ở cuối. Thứ tự hiển thị trên form có thể khác thứ tự cột, nhưng mã, tên và giá trị tương ứng nhất quán.
- Sheet có cột lạ, trùng tiêu đề hoặc cột Mã phiếu bị đổi vị trí sẽ báo lỗi để đối chiếu; không tự xóa cột không nhận diện được.

## Cập nhật hệ thống đang dùng

Thực hiện một lần khi đưa tính năng quản lý biểu mẫu lên máy chủ:

1. Sao lưu database và lưu phiên bản Apps Script hiện có để có thể quay lại.
2. Triển khai backend/frontend mới. Trong thư mục `backend`, chạy `python -m alembic upgrade head` trước khi khởi động backend. Migration `005_form_management` chỉ thêm bảng bản nháp cấu hình và hàng đợi cấu trúc Sheet; không sửa bệnh án.
3. Nếu dùng Sheets, thay mã bằng toàn bộ `deploy/google_apps_script.js` và giữ tab dữ liệu `gid=0`.
4. Thêm hai Script Properties, xuất bản Web App phiên bản mới và cập nhật ba biến môi trường của backend theo [hướng dẫn Google Sheets](GOOGLE_SHEETS_GUIDE.md).
5. Mở **Quản lý biểu mẫu → Kiểm tra & xem trước**, kiểm tra các câu hỏi/cột rồi xuất bản phiên bản cấu hình đầu tiên. Cấu hình ban đầu được lấy từ bộ câu hỏi hiện có; những trường đã bỏ như ngày điều trị và lý do thiếu dữ liệu không được thêm lại.
6. Xem **Phiên bản & đồng bộ**. Đợi cấu trúc Sheet cập nhật, sau đó đối chiếu trạng thái các phiếu. Nếu lỗi, sửa kết nối/deployment rồi bấm **Thử lại đồng bộ cột**, và **Đồng bộ Google Sheets** trong trang quản lý phiếu nếu cần đối chiếu lại dữ liệu.

Hàng đợi cấu trúc tồn tại trong database và hoạt động cả khi chưa có bệnh án. Tác vụ lỗi tự thử lại tối đa 5 lần, cách nhau ít nhất 1 phút; tác vụ bị gián đoạn được nhận lại sau 5 phút. Nếu chưa kết nối Sheet, form và Excel vẫn hoạt động và admin nhìn thấy trạng thái chưa cấu hình. Chỉ hiển thị thành công sau khi đọc lại tiêu đề cột từ Sheet.

Nếu chưa cập nhật Apps Script, hệ thống không thể xác nhận thao tác đổi cấu trúc. Database vẫn giữ cấu hình/bệnh án; trạng thái Sheet sẽ báo lỗi hoặc chờ, không được coi là đã đồng bộ.

Local Windows: `run_dev.bat` gọi `backend/upgrade_db.py`, tự tạo bản sao SQLite trước khi nâng cấp. Có thể chạy riêng từ thư mục `backend`:

```powershell
& ..\.venv\Scripts\python.exe -B upgrade_db.py
```

Apps Script dùng khóa theo script cho các lần gọi Web App và lưu số phiên bản cấu trúc trong Script Properties. Tham khảo API chính thức: [LockService](https://developers.google.com/apps-script/reference/lock/lock-service), [PropertiesService](https://developers.google.com/apps-script/reference/properties/properties-service).

## Kiểm tra trước khi triển khai

```powershell
# Từ thư mục backend: dùng database/Sheet giả trong toàn bộ test.
& ..\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider --basetemp .pytest-tmp
# Từ thư mục frontend
npm.cmd run build
# Từ thư mục repository: kiểm tra đổi tên/thêm/bỏ cột trên Sheet giả.
node deploy/test_google_apps_script.cjs
```

Đã kiểm tra giao diện trên môi trường QA riêng có database tạm và tắt webhook: thêm câu hỏi ngày, lưu nháp, xuất bản, tạo/gửi phiếu mới và đối chiếu giá trị ngày trong Excel. Kiểm tra cấu trúc Sheet bằng bản giả không thay thế việc xác minh sau triển khai trên Google Apps Script thật.
