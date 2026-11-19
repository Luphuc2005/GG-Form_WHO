import uuid
from datetime import datetime, timezone, date
from typing import Any, Dict, Generator, List, Optional, Tuple
from sqlalchemy import func, select, or_, cast, String
from sqlalchemy.orm import Session
from app.models.submission import Submission, EXPORTABLE_STATES
from app.models.form_version import FormVersion


class SubmissionRepository:
    @staticmethod
    def get_by_uuid(db: Session, sub_uuid: uuid.UUID) -> Optional[Submission]:
        stmt = select(Submission).where(Submission.submission_uuid == sub_uuid)
        return db.scalars(stmt).first()

    @staticmethod
    def create(db: Session, submission: Submission) -> Submission:
        db.add(submission)
        db.commit()
        db.refresh(submission)
        return submission

    @staticmethod
    def get_stats(db: Session) -> Dict[str, Any]:
        active = Submission.workflow_status.in_(EXPORTABLE_STATES)
        total = db.scalar(select(func.count(Submission.id)).where(active)) or 0

        # Local calendar day; timestamps are stored in UTC.
        from zoneinfo import ZoneInfo
        today_start = datetime.now(ZoneInfo("Asia/Ho_Chi_Minh")).replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
        today = db.scalar(
            select(func.count(Submission.id)).where(active, Submission.created_at >= today_start)
        ) or 0

        # By classification
        class_stmt = select(Submission.classification, func.count(Submission.id)).where(active).group_by(Submission.classification)
        by_class = {row[0]: row[1] for row in db.execute(class_stmt).all()}

        # By form version
        ver_stmt = (
            select(FormVersion.version, func.count(Submission.id))
            .join(Submission, Submission.form_version_id == FormVersion.id)
            .where(active)
            .group_by(FormVersion.version)
        )
        by_ver = {row[0]: row[1] for row in db.execute(ver_stmt).all()}

        by_workflow = dict(db.execute(
            select(Submission.workflow_status, func.count(Submission.id))
            .where(Submission.workflow_status != "trashed")
            .group_by(Submission.workflow_status)
        ).all())
        # Sync progress describes sent records only, never drafts or cancellations.
        by_sync = dict(db.execute(
            select(Submission.sync_status, func.count(Submission.id))
            .where(active).group_by(Submission.sync_status)
        ).all())

        return {
            "total_submissions": total,
            "today_submissions": today,
            "by_classification": by_class,
            "by_form_version": by_ver,
            "by_workflow": by_workflow,
            "by_sync": by_sync,
        }

    @staticmethod
    def get_paginated(
        db: Session,
        skip: int = 0,
        limit: int = 50,
        form_version: Optional[int] = None,
        classification: Optional[str] = None,
        date_from: Optional[datetime] = None,
        date_to: Optional[datetime] = None,
        q: str = "",
    ) -> Tuple[List[Submission], int]:
        stmt = select(Submission).join(FormVersion, Submission.form_version_id == FormVersion.id).where(Submission.workflow_status.in_(("submitted", "changes_requested", "approved")))
        if q.strip():
            term = "%" + q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
            fields = [cast(Submission.submission_uuid, String), Submission.study_code] + [Submission.answers["clinical_data"][key].as_string() for key in ("so_hs", "ho_ten", "encounter_code", "hospital_code")]
            stmt = stmt.where(or_(*(field.ilike(term, escape="\\") for field in fields)))

        if form_version is not None:
            stmt = stmt.where(FormVersion.version == form_version)
        if classification:
            stmt = stmt.where(Submission.classification == classification)
        if date_from:
            stmt = stmt.where(Submission.created_at >= date_from.astimezone(timezone.utc))
        if date_to:
            stmt = stmt.where(Submission.created_at <= date_to.astimezone(timezone.utc))

        # Count total
        count_stmt = select(func.count()).select_from(stmt.subquery())
        total = db.scalar(count_stmt) or 0

        # Query items
        stmt = stmt.order_by(Submission.created_at.desc()).offset(skip).limit(limit)
        items = db.scalars(stmt).all()

        return list(items), total

    @staticmethod
    def stream_all(
        db: Session,
        form_version: Optional[int] = None,
        batch_size: int = 1000
    ) -> Generator[Submission, None, None]:
        """Stream submissions in batches to prevent high RAM consumption."""
        stmt = (
            select(Submission)
            .join(FormVersion, Submission.form_version_id == FormVersion.id)
            .where(Submission.workflow_status.in_(EXPORTABLE_STATES))
            .order_by(Submission.id.asc())
        )
        if form_version is not None:
            stmt = stmt.where(FormVersion.version == form_version)

        # Use yield_per for server-side chunking
        result = db.execute(stmt.execution_options(yield_per=batch_size))
        for row in result:
            yield row[0]
