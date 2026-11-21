"""Private, expiring Excel files generated outside the HTTP request."""
import asyncio
import json
import logging
import re
from pathlib import Path
from datetime import datetime, timezone, timedelta
from sqlalchemy import select, update, func
from app.config import get_settings
from app.database import SessionLocal
from app.models.export_job import ExportJob
from app.models.admin_user import AdminUser
from app.models.submission import Submission, EXPORTABLE_STATES
from app.services.export_svc import ExportService

log = logging.getLogger("export_jobs")


def discard_attempt_file(path):
    try:
        path.unlink(missing_ok=True)
    except OSError:
        # Windows can briefly lock a progress file while the status API reads
        # it. Advisory files are retried by retention; exports remain usable.
        pass


def storage_path(settings, key):
    if not re.fullmatch(r"[a-f0-9-]{36}\.\d+\.(?:xlsx|partial|progress|progress-tmp)", key):
        raise ValueError("Invalid export key")
    base = Path(settings.EXPORT_DIR).resolve()
    path = (base / key).resolve()
    if path.parent != base:
        raise ValueError("Invalid export path")
    return path


def utc(value):
    return value.replace(tzinfo=timezone.utc) if value and value.tzinfo is None else value


def queue_export(db, user):
    # Serialize repeated requests from this account across production API workers.
    db.execute(select(AdminUser.id).where(AdminUser.id == user.id).with_for_update())
    active = db.scalar(select(ExportJob).where(ExportJob.requested_by == user.id,
        ExportJob.status.in_(("pending", "running"))).order_by(ExportJob.created_at.desc()).limit(1))
    if active:
        return active
    job = ExportJob(requested_by=user.id)
    db.add(job)
    db.commit()
    db.refresh(job)
    return job


def present_job(job, settings):
    if job is None:
        return None
    status = job.status
    if job.expires_at and utc(job.expires_at) <= datetime.now(timezone.utc):
        status = "expired"
    count = job.row_count
    if status == "running":
        try:
            progress = json.loads(storage_path(settings, f"{job.id}.{job.attempts}.progress").read_text(encoding="utf-8"))
            count = max(0, int(progress["rows"]))
        except (OSError, ValueError, KeyError):
            pass
    return {"id": job.id, "status": status, "row_count": count, "total_rows": job.total_rows,
            "size_bytes": job.size_bytes, "created_at": job.created_at, "started_at": job.started_at,
            "finished_at": job.finished_at, "expires_at": job.expires_at, "error": job.error,
            "download_url": f"/api/v1/admin/exports/{job.id}/download" if status == "ready" else None}


def expire_files(factory, settings):
    now = datetime.now(timezone.utc)
    with factory() as db:
        jobs = db.scalars(select(ExportJob).where(ExportJob.status == "ready", ExportJob.expires_at <= now)).all()
        for job in jobs:
            if job.storage_key:
                storage_path(settings, job.storage_key).unlink(missing_ok=True)
            job.status = "expired"
        db.commit()
        # Remove abandoned attempt files after a crash. Only generated filenames
        # inside the configured export directory are eligible for cleanup.
        active = {f"{job.id}.{job.attempts}" for job in db.scalars(select(ExportJob).where(ExportJob.status == "running"))}
        retained = {job.storage_key for job in db.scalars(select(ExportJob).where(ExportJob.status == "ready"))}
        base = Path(settings.EXPORT_DIR).resolve()
        if base.is_dir():
            for path in base.iterdir():
                if not re.fullmatch(r"[a-f0-9-]{36}\.\d+\.(?:xlsx|partial|progress|progress-tmp)", path.name):
                    continue
                prefix = path.name.rsplit(".", 1)[0]
                if prefix not in active and path.name not in retained and path.stat().st_mtime < now.timestamp()-86400:
                    storage_path(settings, path.name).unlink(missing_ok=True)


def process_one(factory=SessionLocal, settings=None):
    settings = settings or get_settings()
    now = datetime.now(timezone.utc)
    with factory() as db:
        db.execute(update(ExportJob).where(ExportJob.status == "running",
            ExportJob.started_at < now-timedelta(minutes=30)).values(status="pending"))
        db.commit()
        job = db.scalar(select(ExportJob).where(ExportJob.status == "pending").order_by(ExportJob.created_at).limit(1))
        if job is None:
            return False
        attempt = job.attempts + 1
        claimed = db.execute(update(ExportJob).where(ExportJob.id == job.id, ExportJob.status == "pending",
            ExportJob.attempts == job.attempts).values(status="running", attempts=attempt, started_at=now,
            error=None, row_count=0), execution_options={"synchronize_session": False}).rowcount
        db.commit()
        if claimed != 1:
            return True
        key = f"{job.id}.{attempt}"
        partial = storage_path(settings, key+".partial")
        target = storage_path(settings, key+".xlsx")
        progress = storage_path(settings, key+".progress")
        progress_tmp = storage_path(settings, key+".progress-tmp")
        result = {}
        try:
            partial.parent.mkdir(parents=True, exist_ok=True)
            total = db.scalar(select(func.count(Submission.id)).where(Submission.workflow_status.in_(EXPORTABLE_STATES))) or 0
            db.execute(update(ExportJob).where(ExportJob.id == job.id, ExportJob.attempts == attempt).values(total_rows=total))
            db.commit()
            count = 0
            def report(rows):
                nonlocal count
                count = rows
                try:
                    progress_tmp.write_text(json.dumps({"rows": rows}), encoding="utf-8")
                    progress_tmp.replace(progress)
                except OSError:
                    # Progress is advisory: an open reader must never abort Excel.
                    pass
            with partial.open("w+b") as output:
                ExportService.xlsx_file(db, output=output, on_progress=report)
            partial.replace(target)
            finished = datetime.now(timezone.utc)
            result = {"status": "ready", "storage_key": target.name, "size_bytes": target.stat().st_size,
                      "row_count": count, "finished_at": finished,
                      "expires_at": finished+timedelta(hours=settings.EXPORT_TTL_HOURS)}
        except Exception as error:
            db.rollback()
            log.warning("Excel job %s failed (%s).", job.id, type(error).__name__)
            result = {"status": "failed", "error": "Chưa tạo được file Excel. Dữ liệu vẫn được giữ lại; hãy yêu cầu xuất lại."}
            discard_attempt_file(target)
        finally:
            discard_attempt_file(partial)
            discard_attempt_file(progress)
            discard_attempt_file(progress_tmp)
        completed = db.execute(update(ExportJob).where(ExportJob.id == job.id, ExportJob.status == "running",
            ExportJob.attempts == attempt).values(**result)).rowcount
        db.commit()
        if not completed:
            discard_attempt_file(target)
    return True


async def export_loop():
    last_expiry = 0
    while True:
        try:
            more = await asyncio.to_thread(process_one, SessionLocal, get_settings())
            if asyncio.get_running_loop().time()-last_expiry > 60:
                await asyncio.to_thread(expire_files, SessionLocal, get_settings())
                last_expiry = asyncio.get_running_loop().time()
        except Exception:
            log.warning("Excel queue unavailable; retrying later.")
            more = False
        await asyncio.sleep(1 if more else 3)
