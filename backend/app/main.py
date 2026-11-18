import os
import time
import uuid
import logging
import asyncio
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.exceptions import RequestValidationError
from app.api import health_router, api_v1_router
from app.config import get_settings
from app.core.exceptions import AppException
from app.commands.import_form import import_form_schema
from app.commands.create_admin import bootstrap_admin

settings = get_settings()

# Setup structured logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] [request_id=%(name)s] %(message)s",
)
logger = logging.getLogger("app")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: auto-import default form if exists & DB accessible
    try:
        if os.path.exists(settings.DEFAULT_FORM_FILE):
            logger.info(f"Khởi động: Tự động kiểm tra biểu mẫu mặc định tại {settings.DEFAULT_FORM_FILE}")
            import_form_schema(settings.DEFAULT_FORM_FILE)
        # Bootstrap default admin
        bootstrap_admin()
    except Exception as e:
        logger.warning(f"Lưu ý khi khởi tạo DB/Schema lúc startup (có thể DB chưa migrate): {e}")

    from app.services.record_sync import sync_loop
    sync_task = asyncio.create_task(sync_loop()) if settings.APP_ENV != "test" else None
    try:
        yield
    finally:
        if sync_task:
            sync_task.cancel()
            try:
                await sync_task
            except asyncio.CancelledError:
                pass

    # Shutdown
    logger.info("Tắt ứng dụng...")


app = FastAPI(
    title="WHO Ovarian Tumor Pathology Survey API",
    description="Hệ thống thu thập dữ liệu giải phẫu bệnh u buồng trứng theo phân loại WHO",
    version="1.0.0",
    docs_url="/docs" if settings.ENABLE_DOCS else None,
    redoc_url="/redoc" if settings.ENABLE_DOCS else None,
    openapi_url="/openapi.json" if settings.ENABLE_DOCS else None,
    lifespan=lifespan,
)

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def logging_and_timing_middleware(request: Request, call_next):
    request_id = request.headers.get("X-Request-ID", str(uuid.uuid4()))
    start_time = time.perf_counter()

    response = await call_next(request)

    latency_ms = (time.perf_counter() - start_time) * 1000
    # Safe log: log endpoint, method, status and latency (NEVER log raw request body/medical answers)
    logger.info(
        f"{request.method} {request.url.path} - Status: {response.status_code} - "
        f"Latency: {latency_ms:.2f}ms - RequestID: {request_id}"
    )
    response.headers["X-Request-ID"] = request_id
    return response


# Global Exception Handlers
@app.exception_handler(AppException)
async def app_exception_handler(request: Request, exc: AppException):
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "code": exc.code,
                "message": exc.message,
                "details": exc.details,
            }
        },
        headers=exc.headers,
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    details = []
    for err in exc.errors():
        loc = " -> ".join(str(x) for x in err.get("loc", []))
        msg = err.get("msg", "")
        details.append(f"{loc}: {msg}")

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        content={
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "Dữ liệu yêu cầu không hợp lệ hoặc thiếu thông tin bắt buộc.",
                "details": details,
            }
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception):
    logger.error(f"Lỗi hệ thống ngoài dự tính: {exc}", exc_info=True)
    return JSONResponse(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
        content={
            "error": {
                "code": "INTERNAL_SERVER_ERROR",
                "message": "Đã xảy ra lỗi máy chủ nội bộ. Vui lòng thử lại sau.",
                "details": [],
            }
        },
    )


# Mount routers
app.include_router(health_router)
app.include_router(api_v1_router)
