"""Archived Sheet rows and a durable queue for explicitly requested cleanup."""
from datetime import datetime, timezone
from sqlalchemy import Integer, String, DateTime
from sqlalchemy.types import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column
from app.database import Base


class SheetCleanupJob(Base):
    __tablename__ = "sheet_cleanup_jobs"
    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    snapshot: Mapped[dict] = mapped_column(JSONB().with_variant(JSON, "sqlite"), nullable=False)
    requested_by: Mapped[str] = mapped_column(String(64), nullable=False)
    status: Mapped[str] = mapped_column(String(20), default="pending", nullable=False)
    attempts: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    removed_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    retained_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False)
    attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
