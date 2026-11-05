@echo off
cd /d "%~dp0"
chcp 65001 > nul

echo ====================================================================
echo    KHOI CHAY HE THONG KHAO SAT GIAI PHAU BENH U BUONG TRUNG
echo ====================================================================
echo.

set "PYTHON_EXE=%~dp0.venv\Scripts\python.exe"
if not exist "%PYTHON_EXE%" (
    echo Chua co .venv. Hay tao moi truong va cai dependencies theo README.md.
    exit /b 1
)
if not exist "%~dp0backend\.env" (
    echo Chua co backend\.env. Hay cau hinh theo README.md truoc khi chay.
    exit /b 1
)
if not exist "%~dp0frontend\node_modules\vite\bin\vite.js" (
    echo Chua cai frontend dependencies. Hay chay npm.cmd ci trong frontend.
    exit /b 1
)

echo [1/3] Khoi tao co so du lieu...
cd /d "%~dp0backend"
"%PYTHON_EXE%" init_local_db.py
if errorlevel 1 exit /b 1
cd /d "%~dp0"

echo.
echo [2/3] Dang khoi dong Backend FastAPI tai cong 8000...
start "Backend FastAPI" /D "%~dp0backend" cmd /k ""%PYTHON_EXE%" -m uvicorn app.main:app --reload --port 8000"

echo.
echo [3/3] Dang khoi dong Frontend Vite tai cong 5173...
start "Frontend Vite" /D "%~dp0frontend" cmd /k "npm.cmd run dev -- --host 127.0.0.1 --strictPort"

echo.
echo ====================================================================
echo  DA GUI LENH KHOI DONG. XEM LOG TRONG HAI CUA SO VA KIEM TRA URL BEN DUOI.
echo.
echo  - Form khao sat:     http://localhost:5173/
echo  - Quan tri Admin:    http://localhost:5173/admin
echo    (Tai khoan: admin / Mat khau: admin123)
echo  - API Docs Swagger:  http://localhost:8000/docs
echo ====================================================================
echo.
echo Dang mo trinh duyet...
ping 127.0.0.1 -n 4 > nul
start http://localhost:5173/
