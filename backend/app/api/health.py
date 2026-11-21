from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db
from app.services.deployment_checks import verify_current_schema

router = APIRouter(tags=["Health"])


@router.get("/health/live", status_code=status.HTTP_200_OK)
def liveness():
    """Liveness probe to check if the application process is running."""
    return {"status": "ok", "check": "live"}


@router.get("/health/ready", status_code=status.HTTP_200_OK)
def readiness(db: Session = Depends(get_db)):
    """A database connection is ready only after all application migrations."""
    try:
        db.execute(text("SELECT 1"))
        revision = verify_current_schema(db)
        return {"status": "ok", "check": "ready", "database": "connected", "schema_revision": revision}
    except Exception:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "check": "ready", "database": "not_ready",
                     "message": "Kiểm tra kết nối database và chạy đủ migration trước khi mở ứng dụng."}
        )
