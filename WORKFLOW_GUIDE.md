# Nhập form trực tiếp và quản lý dữ liệu

## Sinh viên

1. Mở `/` (local: http://localhost:5173/). Form hiện ngay, không cần tài khoản hoặc đăng nhập.
2. Mỗi phiếu là một đợt điều trị/phẫu thuật. Chọn bệnh viện TD/HV/YD/GD/UB và giai đoạn R (Hồi cứu, 2021–2026) hoặc P (Tiến cứu, 2027–2029), điền số hồ sơ và các thông tin lấy từ hồ sơ nguồn. Mã nghiên cứu dạng `YD_R_00001` được máy chủ cấp khi gửi; bản nháp chưa chiếm số. Không nhập LEFT/RIGHT/BOTH ở giai đoạn này. Biến bệnh viện trung tâm ung thư được suy ra tự động: UB = 1; TD/HV/YD/GD = 0, không yêu cầu người nhập điền thêm. Mọi kết quả chuyên môn bắt đầu ở trạng thái chưa nhập.
3. Phiếu tự lưu nháp lên máy chủ sau khoảng 1,2 giây ngừng nhập. Menu **Các mục trong phiếu** chuyển nhanh đến từng phần; trên máy tính nằm bên trái, trên điện thoại có đủ 8 nút. **Thu gọn tất cả / Mở tất cả** chỉ thay đổi hiển thị, không xóa dữ liệu. Thanh **Gửi phiếu** và trạng thái lưu nháp nằm cuối màn hình. Bấm vào nhãn câu hỏi để đưa con trỏ vào ô nhập; dùng Tab/Shift+Tab để chuyển ô. Thông tin chưa có có thể để trống. Form không còn ô ngày điều trị/phẫu thuật hoặc mục ghi nhận lý do thiếu dữ liệu.
4. **Gửi phiếu** ghi nhận ngay, xếp vào hàng đợi đồng bộ Google Sheets và đưa vào dữ liệu Excel/CSV. Không có bước bác sĩ duyệt trước khi xuất hoặc đồng bộ.
5. Sau thông báo thành công, bấm **Nhập bệnh án mới** để mở phiếu trắng hoàn toàn. Không nhập bệnh nhân khác vào phiếu cũ.

Bản nháp gắn với khóa riêng trong phiên trình duyệt. Tải lại cùng tab có thể nhập tiếp; không có danh sách bệnh án công khai và không truy cập được bản nháp từ thiết bị khác nếu không có khóa. Giữ tab khi mất mạng; hệ thống thử lưu lại khi có kết nối. Chỉ các thay đổi được máy chủ xác nhận mới được bảo đảm đã lưu.

## Bác sĩ

Tài khoản **admin** có thêm **Quản lý biểu mẫu** tại `/admin/form-builder`. Xem [hướng dẫn cấu hình, phiên bản và cập nhật cột Sheet](FORM_MANAGEMENT_GUIDE.md). Tài khoản bác sĩ tiếp tục sửa bệnh án và xuất dữ liệu; không thay cấu trúc biểu mẫu.

1. Tự mở `/admin` (local: http://localhost:5173/admin), đăng nhập bằng tài khoản quản trị hiện có.
2. `/admin` luôn mở danh sách phiếu, không tự mở lại phiếu cũ. Tìm theo số hồ sơ, họ tên, mã nghiên cứu, mã đợt cũ hoặc mã phiếu; dùng các thẻ trạng thái và nút **Bộ lọc** để lọc thêm ngày/người nhập. Các phiếu nhập công khai ghi nguồn **Nhập form trực tiếp**.
3. Mở **Xem phiếu → Sửa phiếu**, chỉnh nội dung, bấm **Lưu thay đổi** trên thanh thao tác. Các mục lâm sàng, xét nghiệm, MRI, phẫu thuật được thu gọn; bấm tiêu đề mục hoặc thanh điều hướng để mở phần cần xem. Nút **Thông tin** mở bảng phụ chứa nguồn nhập, Google Sheets và lịch sử sửa. Không cần mở lại hoặc duyệt. Máy chủ lưu bản trước/sau, người sửa và thời điểm; dữ liệu Excel/CSV cập nhật ngay, Sheet được xếp hàng cập nhật theo cùng UUID.
4. Trong bảng **Thông tin**, **Hủy phiếu** cần lý do, giữ dữ liệu và lịch sử; phiếu hủy không được xuất và được xếp hàng gỡ khỏi Sheet.
5. **Mở Google Sheet** ở đầu trang mở Sheet đang dùng trong tab mới; menu cạnh tài khoản có **Đồng bộ Google Sheets** để yêu cầu đồng bộ lại toàn bộ phiếu đã gửi. **Xuất Excel** tải file Excel (.xlsx) thật, giữ số 0 đầu của số hồ sơ và PARA. Menu cạnh tên tài khoản chứa **Tải CSV**, **Thống kê**, **Quản lý tài khoản** và **Đăng xuất**. Mọi phiếu đã gửi đều nằm trong dữ liệu xuất, kể cả phiếu cũ chưa từng duyệt; nháp và phiếu hủy không nằm trong đó.
6. **Quản lý tài khoản** trong menu cạnh tên đăng nhập chỉ dùng nếu cần cấp thêm người quản trị/bác sĩ. Không phải cấp tài khoản cho sinh viên nhập form.

## Lưu trữ, tránh trùng và đồng bộ

- Database là nơi lưu chính. UUID cố định qua các lần lưu/thử gửi lại. Mã nghiên cứu gồm mã bệnh viện + R/P + số thứ tự 5 chữ số, tăng liên tục riêng theo từng bệnh viện/giai đoạn, không bắt đầu lại theo năm. Máy chủ cấp số trong cùng giao dịch gửi phiếu; gửi lại, sửa hoặc hủy không tái cấp/tái sử dụng số. Bệnh viện và giai đoạn được khóa sau khi có mã. Phiếu cũ giữ nguyên định danh và mã đợt hiện có.
- Form mới không thu ngày điều trị/phẫu thuật; bác sĩ cần đối chiếu danh sách khi kiểm tra trùng đợt. Phiếu cũ đã lưu đủ bệnh viện + số hồ sơ + ngày điều trị vẫn được đối chiếu theo bộ thông tin này; phiếu theo định danh cũ tiếp tục dùng mã bệnh viện + số hồ sơ + mã đợt. Số 0 đầu của số hồ sơ/PARA được giữ nguyên.
- Danh mục hiện tại: Số lượng u ở Siêu âm/MRI chọn Trái, Phải hoặc 2 bên; dạng tổn thương MRI chọn Nang đơn thùy, Nang đa thùy hoặc U đặc; sinh thiết lạnh chọn Không, Lành tính hoặc Ác tính. Mục dịch ổ bụng khi phẫu thuật đã bỏ khỏi form, mục VI còn 5 mục. Dữ liệu cũ và cột xuất tương ứng được giữ nguyên; các lựa chọn cũ chỉ hiển thị khi đã được lưu, không dùng để nhập phiếu mới. Không tự đổi “1 bên” thành trái/phải hoặc suy ra lành/ác từ “Có”.
- Hai phiên sửa một phiếu có kiểm tra phiên bản lần lưu, không tự ghi đè thay đổi của người khác. Khi xung đột, đối chiếu rồi tải lại.
- Backend kiểm tra kiểu dữ liệu, danh mục, số không âm, tỷ lệ. Quy ước riêng của phiếu nghiên cứu là nhập đủ cả 6 ô IOTA (mỗi ô 0–100%) và tổng 6 ô bằng 100%; nếu không có kết quả thì để trống toàn bộ. Đây là quy ước thu thập riêng, không phải quan hệ tổng nguy cơ/nhóm con của ADNEX chuẩn. Không tự cân hoặc đổi số trong hồ sơ để đủ tổng. Các phiếu cũ không bị tự sửa giá trị. Bác sĩ phụ trách chốt định nghĩa biến, đơn vị xét nghiệm/kích thước và danh mục chuyên môn theo đề cương.
- Đồng bộ Sheet có trạng thái chờ/đang chạy/thành công/lỗi/chưa cấu hình; hàng đợi nằm trong database. Sau lỗi tự thử tối đa 5 lần, cách nhau ít nhất 1 phút; có nút thử lại tại admin. Tác vụ bị gián đoạn được nhận lại sau 5 phút.
- Khi sửa phiếu, worker gỡ dòng cùng UUID rồi ghi bản mới và đọc lại để kiểm tra. Lỗi có thể tạm làm dòng vắng trên Sheet; database vẫn giữ đủ dữ liệu. Nếu không kết nối được Sheet, phiếu vẫn lưu và xuất Excel bình thường.
- Khi nâng cấp Sheet cũ, sao lưu trước và xem danh sách cột ở `/admin/form-builder` trước khi xuất bản. Cấu trúc mới ẩn UUID ở cột vật lý đầu tiên **ID đồng bộ** và đặt mã nghiên cứu ở cột hiển thị **Mã phiếu**. Cột lạ hoặc trùng tên cần được đối chiếu với cấu hình trước khi đồng bộ. Xem [hướng dẫn quản lý biểu mẫu](FORM_MANAGEMENT_GUIDE.md) và [thiết lập webhook có xác thực](GOOGLE_SHEETS_GUIDE.md).
- Chỉ admin/bác sĩ được xem danh sách, sửa phiếu, xem lịch sử hoặc xuất dữ liệu. Sau khi sinh viên gửi, khóa nháp không cho đọc nội dung đã được bác sĩ sửa hoặc sửa lại phiếu đó.

## Nâng cấp và chạy local

```powershell
cd E:\HocTap\GG-Form_WHO
.\run_dev.bat
```

SQLite được sao lưu tại `backend/backups/` trước khi cập nhật schema. Dữ liệu và mật khẩu hiện có được giữ nguyên. Máy chủ PostgreSQL dùng sao lưu riêng rồi chạy `python -m alembic upgrade head`, cài dependencies mới và khởi động lại backend/frontend. Không dùng `init_local_db.py` để nâng cấp PostgreSQL.

Các bài test dùng database và Sheet giả; không gửi dữ liệu thử lên Sheet bệnh viện. Việc đồng bộ thực tế còn phụ thuộc cấu hình webhook và quyền đọc Sheet hiện có.
