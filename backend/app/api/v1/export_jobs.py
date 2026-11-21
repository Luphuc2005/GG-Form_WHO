"""Authenticated creation, status and download of background Excel exports."""
import uuid
from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.database import get_db
from app.config import get_settings
from app.core.exceptions import AppException, NotFoundException
from app.models.admin_user import AdminUser
from app.models.export_job import ExportJob
from app.services.auth_svc import AuthService
from app.services import export_jobs as service

router = APIRouter(prefix="/admin/exports", tags=["Admin"])


def owned(db, key, user):
    job = db.get(ExportJob, str(key))
    if job is None or job.requested_by != user.id:
        raise NotFoundException("Không tìm thấy yêu cầu xuất Excel của bạn.")
    return job


@router.post("", status_code=202)
def create_export(db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_admin)):
    return service.present_job(service.queue_export(db, user), get_settings())


@router.get("/latest")
def latest_export(db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_admin)):
    job = db.scalar(select(ExportJob).where(ExportJob.requested_by == user.id).order_by(ExportJob.created_at.desc()).limit(1))
    return service.present_job(job, get_settings())


@router.get("/{key}")
def export_status(key: uuid.UUID, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_admin)):
    return service.present_job(owned(db, key, user), get_settings())


@router.get("/{key}/download")
def download_export(key: uuid.UUID, db: Session = Depends(get_db), user: AdminUser = Depends(AuthService.get_current_admin)):
    job = owned(db, key, user)
    if job.expires_at and service.utc(job.expires_at) <= datetime.now(timezone.utc):
        raise AppException(410, "EXPORT_EXPIRED", "File đã hết hạn. Bấm Xuất Excel mới để tạo lại.")
    if job.status != "ready" or not job.storage_key:
        raise AppException(409, "EXPORT_NOT_READY", "File Excel chưa sẵn sàng. Chờ tác vụ hoàn tất trước khi tải.")
    path = service.storage_path(get_settings(), job.storage_key)
    if not path.is_file():
        raise AppException(410, "EXPORT_EXPIRED", "File không còn trên máy chủ. Bấm Xuất Excel mới để tạo lại.")
    return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        filename=f"ovarian_submissions_{job.created_at:%Y%m%d_%H%M%S}.xlsx", headers={"Cache-Control": "no-store"})
