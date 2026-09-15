@echo off
chcp 65001 > nul
echo ====================================================================
echo    KHỞI CHẠY HỆ THỐNG KHẢO SÁT GIẢI PHẪU BỆNH U BUỒNG TRỨNG (DEV)
echo ====================================================================
echo.

echo [1/3] Đang kiểm tra và khởi tạo Cơ sở dữ liệu...
cd backend
python init_local_db.py
cd ..

echo.
echo [2/3] Đang khởi động Backend FastAPI (cổng 8000)...
start "Ovarian Survey - Backend (FastAPI)" cmd /k "cd backend && uvicorn app.main:app --reload --port 8000"

echo.
echo [3/3] Đang khởi động Frontend React/Vite (cổng 5173)...
start "Ovarian Survey - Frontend (React/Vite)" cmd /k "cd frontend && npm run dev"

echo.
echo ====================================================================
echo  CẢ HAI DỊCH VỤ ĐANG ĐƯỢC CHẠY TRONG CỬA SỔ RIÊNG!
echo.
echo  👉 Khảo sát (Người dùng):   http://localhost:5173/
echo  👉 Trang Quản trị (Admin):  http://localhost:5173/admin
echo     (Tài khoản: admin / Mật khẩu: admin123)
echo  👉 API Swagger Docs:        http://localhost:8000/docs
echo ====================================================================
timeout /t 3 > nul
start http://localhost:5173/
