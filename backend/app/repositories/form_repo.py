from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.form_version import FormVersion


class FormRepository:
    @staticmethod
    def get_published_by_key(db: Session, form_key: str) -> Optional[FormVersion]:
        stmt = (
            select(FormVersion)
            .where(FormVersion.form_key == form_key, FormVersion.status == "published")
            .order_by(FormVersion.version.desc())
            .limit(1)
        )
        return db.scalars(stmt).first()

    @staticmethod
    def get_by_key_and_version(db: Session, form_key: str, version: int) -> Optional[FormVersion]:
        stmt = select(FormVersion).where(
            FormVersion.form_key == form_key,
            FormVersion.version == version
        )
        return db.scalars(stmt).first()

    @staticmethod
    def save(db: Session, form_version: FormVersion) -> FormVersion:
        db.add(form_version)
        db.commit()
        db.refresh(form_version)
        return form_version
