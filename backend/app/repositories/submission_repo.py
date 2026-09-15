import uuid
from datetime import datetime, timezone, date
from typing import Any, Dict, Generator, List, Optional, Tuple
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.models.submission import Submission
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
        total = db.scalar(select(func.count(Submission.id))) or 0

        # Submissions created today (UTC)
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        today = db.scalar(
            select(func.count(Submission.id)).where(Submission.created_at >= today_start)
        ) or 0

        # By classification
        class_stmt = select(Submission.classification, func.count(Submission.id)).group_by(Submission.classification)
        by_class = {row[0]: row[1] for row in db.execute(class_stmt).all()}

        # By form version
        ver_stmt = (
            select(FormVersion.version, func.count(Submission.id))
            .join(Submission, Submission.form_version_id == FormVersion.id)
            .group_by(FormVersion.version)
        )
        by_ver = {row[0]: row[1] for row in db.execute(ver_stmt).all()}

        return {
            "total_submissions": total,
            "today_submissions": today,
            "by_classification": by_class,
            "by_form_version": by_ver,
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
    ) -> Tuple[List[Submission], int]:
        stmt = select(Submission).join(FormVersion, Submission.form_version_id == FormVersion.id)

        if form_version is not None:
            stmt = stmt.where(FormVersion.version == form_version)
        if classification:
            stmt = stmt.where(Submission.classification == classification)
        if date_from:
            stmt = stmt.where(Submission.created_at >= date_from)
        if date_to:
            stmt = stmt.where(Submission.created_at <= date_to)

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
            .order_by(Submission.id.asc())
        )
        if form_version is not None:
            stmt = stmt.where(FormVersion.version == form_version)

        # Use yield_per for server-side chunking
        result = db.execute(stmt.execution_options(yield_per=batch_size))
        for row in result:
            yield row[0]
