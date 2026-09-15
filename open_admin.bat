@echo off
chcp 65001 > nul
echo ====================================================================
echo    ĐANG KHỞI CHẠY HỆ THỐNG QUẢN TRỊ VIÊN (ADMIN DASHBOARD)...
echo ====================================================================

:: 1. Kiem tra Backend (cong 8000)
netstat -ano | findstr /R ":8000 " > nul
if %errorlevel% neq 0 (
    echo [1/2] May chu Backend chua chay. Dang khoi dong Backend FastAPI...
    start "Ovarian Survey - Backend" /min cmd /k "cd /d %~dp0backend && python -m uvicorn app.main:app --port 8000 --reload"
    timeout /t 3 > nul
) else (
    echo [1/2] May chu Backend da san sang.
)

:: 2. Kiem tra Frontend (cong 5173)
netstat -ano | findstr /R ":5173 " > nul
if %errorlevel% neq 0 (
    echo [2/2] Giao dien Web chua chay. Dang khoi dong Frontend React...
    start "Ovarian Survey - Frontend" /min cmd /k "cd /d %~dp0frontend && npm run dev"
    timeout /t 3 > nul
) else (
    echo [2/2] Giao dien Web da san sang.
)

echo.
echo ====================================================================
echo   Dang mo Trinh duyet vao trang Quan tri Admin...
echo   Dia chi: http://localhost:5173/admin
echo   Tai khoan: admin  ^|  Mat khau: admin123
echo ====================================================================
timeout /t 1 > nul
start http://localhost:5173/admin
