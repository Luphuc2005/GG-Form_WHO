# Hệ thống thu thập bệnh án và giải phẫu bệnh u buồng trứng

Ứng dụng React/TypeScript và FastAPI phục vụ nhập phiếu nghiên cứu, quản trị dữ liệu, xuất CSV và đồng bộ Google Sheets. Database local dùng SQLite; triển khai Docker dùng PostgreSQL 16 và Nginx.

## Chức năng hiện tại

- Biểu mẫu tổng hợp tại `/`: hành chính, tiền sử/lâm sàng, dấu ấn sinh học, siêu âm, MRI, phẫu thuật và kết quả GPB theo WHO.
- Lưu nháp trong `sessionStorage`; nút **Xóa tất cả thông tin** ở đầu phiếu xóa nội dung đang nhập, giữ nguyên phiếu đã gửi.
- `/admin`: thống kê, danh sách và chi tiết phiếu, xuất CSV, xóa phiếu và đối chiếu Google Sheets.
- `/develop`: chỉnh sửa và xem trước schema GPB. Các trường lâm sàng của trang tổng hợp được khai báo riêng trong `ComprehensiveFormPage.tsx`.
- API kiểm tra UUID và hash nội dung để xử lý yêu cầu gửi lại. Trang tổng hợp hiện sinh UUID mới cho mỗi lần bấm gửi.
- CSV có tiêu đề tiếng Việt, dữ liệu lâm sàng theo cột, kết quả WHO gộp một cột và UTF-8 BOM để mở trong Excel.

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

Đọc [hướng dẫn Google Sheets](GOOGLE_SHEETS_GUIDE.md), [triển khai](DEPLOYMENT.md), [bàn giao máy chủ](DEPLOYMENT_FOR_TEACHER.md) và [sao lưu](BACKUP_GUIDE.md).

Đối với Docker, tạo `.env` ở gốc từ [.env.example](.env.example), thay các giá trị mẫu rồi làm theo hướng dẫn triển khai. Không đưa `.env`, database, `ex_data/`, log, môi trường Python hoặc script thử local vào Git.
