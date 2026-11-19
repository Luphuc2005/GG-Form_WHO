# Hệ thống thu thập bệnh án và giải phẫu bệnh u buồng trứng

Ứng dụng React/TypeScript và FastAPI phục vụ nhập phiếu nghiên cứu, quản trị dữ liệu, xuất CSV và đồng bộ Google Sheets. Database local dùng SQLite; triển khai Docker dùng PostgreSQL 16 và Nginx.

## Chức năng hiện tại

- `/`: sinh viên mở form và nhập trực tiếp, không cần đăng nhập. `/admin`: bác sĩ đăng nhập để xem, sửa, hủy phiếu và xuất Excel/CSV.
- `/admin/form-builder`: admin thêm/sửa/ngừng dùng câu hỏi, quản lý danh mục WHO, lưu nháp trên máy chủ, xem trước và xuất bản phiên bản mới. Form nhập, backend, Excel/CSV và đồng bộ cột Sheet sử dụng cùng cấu hình. Đọc [hướng dẫn quản lý biểu mẫu và cập nhật Apps Script](FORM_MANAGEMENT_GUIDE.md) trước khi triển khai tính năng này.
- Một phiếu cho một đợt điều trị/phẫu thuật. Mã bệnh viện + số hồ sơ + mã đợt dùng để chống trùng; UUID giữ nguyên khi lưu và gửi lại.
- Tự lưu nháp lên máy chủ trong phiên nhập hiện tại; **Gửi phiếu** ghi nhận dữ liệu ngay, không có bước chờ bác sĩ duyệt. Khóa riêng của bản nháp chỉ cho truy cập đúng phiếu đó; không mở danh sách bệnh án cho người nhập công khai.
- Hủy phiếu có lý do, giữ dữ liệu và lịch sử; tìm kiếm toàn bộ database, lọc người nhập/trạng thái/ngày. Excel (.xlsx), CSV và Google Sheets nhận mọi phiếu đã gửi, không cần duyệt.
- **Xóa** đưa phiếu vào **Thùng rác**; **Khôi phục** trả phiếu về trạng thái trước đó. Admin/bác sĩ thực hiện từ danh sách hoặc chi tiết. Phiếu trong thùng rác được loại khỏi thống kê, Excel/CSV và xếp hàng gỡ khỏi Google Sheets.
- **Kết luận siêu âm** là ô nhập nhiều dòng dưới **Tổn thương NMTC**, trước **IOTA ADNEX**. Có thể để trống; nội dung được lưu và xuất cùng phiếu.
- `/admin/reports`: thống kê, chi tiết phiếu, CSV và đối chiếu Google Sheets. Đồng bộ có trạng thái, hàng đợi bền vững và thử lại sau lỗi.
- `/develop`: công cụ GPB cũ được giữ tương thích. Dùng `/admin/form-builder` để quản lý cả câu hỏi lâm sàng và GPB. Phiếu chưa có cấu hình lâm sàng theo phiên bản tiếp tục dùng giao diện cũ; các phiên bản do trình quản lý mới xuất bản dùng form sinh từ cấu hình.
- Backend kiểm tra kiểu dữ liệu, danh mục, định danh đợt, tỷ lệ: theo quy ước nghiên cứu hiện tại, cả 6 ô IOTA nhập đủ và có tổng 100%; không tự cân số. Phiếu mới để trống toàn bộ kết quả chuyên môn.
- CSV có tiêu đề tiếng Việt, dữ liệu lâm sàng theo cột, WHO 1 và WHO 2 ở hai cột riêng và UTF-8 BOM để mở trong Excel. WHO 1 là kết quả chính bắt buộc; WHO 2 không bắt buộc. Thống kê bản chất u dùng WHO 1; từng kết quả hiển thị bản chất u và mã ICD-O riêng.

## Chạy local trên Windows

Yêu cầu Python 3.12+ và Node.js 20+. Chạy tại thư mục repository:

```powershell
python -m venv .venv
& .\.venv\Scripts\python.exe -m pip install -e './backend[dev]'
cd frontend
npm.cmd ci
cd ..
```

Tạo `backend/.env` với cấu hình local, không commit file này:

```dotenv
APP_ENV=development
DATABASE_URL=sqlite:///./local_survey.db
SECRET_KEY=replace-with-a-long-random-development-secret
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin123
ENABLE_DOCS=true
```

Tài khoản trên chỉ là cấu hình phát triển mẫu. Khởi tạo database một lần:

```powershell
cd backend
& ..\.venv\Scripts\python.exe init_local_db.py
```

Mở hai terminal PowerShell, dùng đường dẫn checkout của bạn:

```powershell
# Terminal 1
cd E:\HocTap\GG-Form_WHO\backend
& ..\.venv\Scripts\python.exe -m uvicorn app.main:app --reload --port 8000
```

```powershell
# Terminal 2
cd E:\HocTap\GG-Form_WHO\frontend
npm.cmd run dev -- --host 127.0.0.1 --strictPort
```

Hoặc chạy `run_dev.bat` sau khi thiết lập môi trường. Script dùng `.venv` của repository. Giữ terminal mở trong lúc sử dụng; Ctrl+C dừng tiến trình tương ứng.

- Biểu mẫu: http://localhost:5173/
- Quản trị: http://localhost:5173/admin
- API Docs: http://localhost:8000/docs
- Kiểm tra database: http://localhost:8000/health/ready

## Kiểm thử và build

```powershell
cd backend
& ..\.venv\Scripts\python.exe -m pytest tests -q -p no:cacheprovider --basetemp .pytest-tmp
cd ..\frontend
npm.cmd run build
```

Các test API dùng SQLite trong bộ nhớ và tắt webhook để không ghi dữ liệu thử lên Sheet thật. Kiểm tra health xác nhận kết nối database, không thay thế kiểm tra giao diện hoặc đối chiếu dữ liệu trên Sheet.

## Google Sheets và triển khai

Đọc [hướng dẫn nhập, nâng cấp và đồng bộ](WORKFLOW_GUIDE.md) trước khi sử dụng quy trình mới. SQLite được sao lưu trước khi nâng cấp schema. Phiếu cũ vẫn có trong bộ dữ liệu xuất. CSV/Excel và Google Sheets không xuất ngày điều trị/phẫu thuật, trạng thái phiếu, người nhập, người duyệt, thời gian duyệt hoặc lý do thiếu dữ liệu. Đồng bộ hỗ trợ cả header đầy đủ và bộ cột cũ thuộc danh mục xuất, giữ nguyên cấu trúc Sheet hiện có.

Đọc [hướng dẫn Google Sheets](GOOGLE_SHEETS_GUIDE.md), [triển khai](DEPLOYMENT.md), [bàn giao máy chủ](DEPLOYMENT_FOR_TEACHER.md) và [sao lưu](BACKUP_GUIDE.md).

Đối với Docker, tạo `.env` ở gốc từ [.env.example](.env.example), thay các giá trị mẫu rồi làm theo hướng dẫn triển khai. Không đưa `.env`, database, `ex_data/`, log, môi trường Python hoặc script thử local vào Git.
