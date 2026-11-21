import uuid
from datetime import datetime, timezone
from sqlalchemy import BigInteger, Integer, String, DateTime, ForeignKey, Index
from sqlalchemy.dialects.postgresql import UUID as PG_UUID, JSONB
from sqlalchemy.types import JSON, CHAR, TypeDecorator
from sqlalchemy.orm import Mapped, mapped_column, relationship
from app.database import Base

EXPORTABLE_STATES = ("submitted", "approved", "changes_requested")


class GUID(TypeDecorator):
    """Platform-independent GUID/UUID type.
    Uses PostgreSQL's UUID type, otherwise uses CHAR(36).
    """
    impl = CHAR
    cache_ok = True

    def load_dialect_impl(self, dialect):
        if dialect.name == "postgresql":
            return dialect.type_descriptor(PG_UUID(as_uuid=True))
        else:
            return dialect.type_descriptor(CHAR(36))

    def process_bind_param(self, value, dialect):
        if value is None:
            return value
        elif dialect.name == "postgresql":
            return value
        else:
            if not isinstance(value, uuid.UUID):
                return str(uuid.UUID(value))
            else:
                return str(value)

    def process_result_value(self, value, dialect):
        if value is None:
            return value
        else:
            if not isinstance(value, uuid.UUID):
                return uuid.UUID(value)
            return value


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (
        Index("ix_submissions_form_version_id", "form_version_id"),
        Index("ix_submissions_created_at", "created_at"),
        Index("ix_submissions_classification", "classification"),
        Index("ix_submissions_sync_queue", "sync_status", "sync_attempted_at"),
        Index("ix_submissions_state_created", "workflow_status", "created_at", "id"),
        Index("ix_submissions_owner_created", "owner_id", "created_at", "id"),
    )

    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    submission_uuid: Mapped[uuid.UUID] = mapped_column(GUID(), unique=True, nullable=False, index=True)
    form_version_id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), ForeignKey("form_versions.id"), nullable=False)
    payload_hash: Mapped[str] = mapped_column(String(64), nullable=False, index=True)
    classification: Mapped[str] = mapped_column(String(32), nullable=False)
    answers: Mapped[dict] = mapped_column(JSONB().with_variant(JSON, "sqlite"), nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        default=lambda: datetime.now(timezone.utc)
    )

    form_version = relationship("FormVersion", back_populates="submissions")
    trashed_from_state: Mapped[str | None] = mapped_column(String(24), nullable=True)
    trashed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True, index=True)
    public_access_hash: Mapped[str | None] = mapped_column(String(64), nullable=True)
    identity_version: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    study_code: Mapped[str | None] = mapped_column(String(16), nullable=True, unique=True)
    study_number: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reviewer_id: Mapped[int | None] = mapped_column(ForeignKey("admin_users.id"), nullable=True)
    workflow_status: Mapped[str] = mapped_column(String(24), default="submitted", server_default="submitted", nullable=False, index=True)
    revision: Mapped[int] = mapped_column(Integer, default=1, server_default="1", nullable=False)
    encounter_key: Mapped[str | None] = mapped_column(String(64), nullable=True, unique=True)
    updated_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_note: Mapped[str | None] = mapped_column(String(2000), nullable=True)
    sync_status: Mapped[str] = mapped_column(String(24), default="not_requested", server_default="not_requested", nullable=False)
    sync_error: Mapped[str | None] = mapped_column(String(500), nullable=True)
    sync_attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0", nullable=False)
    synced_revision: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sync_attempted_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    owner = relationship("AdminUser", foreign_keys=[owner_id])
    reviewer = relationship("AdminUser", foreign_keys=[reviewer_id])
