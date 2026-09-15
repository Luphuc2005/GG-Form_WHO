from typing import Optional
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.models.admin_user import AdminUser


class AdminRepository:
    @staticmethod
    def get_by_username(db: Session, username: str) -> Optional[AdminUser]:
        stmt = select(AdminUser).where(AdminUser.username == username)
        return db.scalars(stmt).first()

    @staticmethod
    def create_or_update(db: Session, username: str, password_hash: str) -> AdminUser:
        user = AdminRepository.get_by_username(db, username)
        if user:
            user.password_hash = password_hash
            user.is_active = True
        else:
            user = AdminUser(username=username, password_hash=password_hash, is_active=True)
            db.add(user)
        db.commit()
        db.refresh(user)
        return user
