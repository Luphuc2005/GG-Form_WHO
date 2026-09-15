from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.database import get_db

router = APIRouter(tags=["Health"])


@router.get("/health/live", status_code=status.HTTP_200_OK)
def liveness():
    """Liveness probe to check if the application process is running."""
    return {"status": "ok", "check": "live"}


@router.get("/health/ready", status_code=status.HTTP_200_OK)
def readiness(db: Session = Depends(get_db)):
    """Readiness probe to check if database connectivity is working."""
    try:
        db.execute(text("SELECT 1"))
        return {"status": "ok", "check": "ready", "database": "connected"}
    except Exception as exc:
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            content={"status": "unavailable", "check": "ready", "database": str(exc)}
        )
