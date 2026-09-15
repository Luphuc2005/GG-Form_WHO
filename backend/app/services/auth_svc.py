from typing import Optional
from fastapi import Depends, Request
from sqlalchemy.orm import Session
from app.config import get_settings
from app.core.exceptions import UnauthorizedException
from app.core.security import create_access_token, decode_access_token, verify_password
from app.database import get_db
from app.models.admin_user import AdminUser
from app.repositories.admin_repo import AdminRepository

settings = get_settings()


class AuthService:
    @staticmethod
    def authenticate_admin(db: Session, username: str, password: str) -> AdminUser:
        user = AdminRepository.get_by_username(db, username)
        if not user or not user.is_active:
            raise UnauthorizedException("Tên đăng nhập hoặc mật khẩu không chính xác.")
        if not verify_password(password, user.password_hash):
            raise UnauthorizedException("Tên đăng nhập hoặc mật khẩu không chính xác.")
        return user

    @staticmethod
    def create_token_for_user(user: AdminUser) -> str:
        return create_access_token(data={"sub": user.username, "user_id": user.id})

    @staticmethod
    def get_current_admin(
        request: Request,
        db: Session = Depends(get_db)
    ) -> AdminUser:
        # Check Authorization Bearer header first
        auth_header = request.headers.get("Authorization")
        token = None
        if auth_header and auth_header.startswith("Bearer "):
            token = auth_header.split(" ", 1)[1]
        elif settings.ADMIN_COOKIE_NAME in request.cookies:
            token = request.cookies.get(settings.ADMIN_COOKIE_NAME)

        if not token:
            raise UnauthorizedException("Yêu cầu đăng nhập quản trị.")

        payload = decode_access_token(token)
        if not payload or "sub" not in payload:
            raise UnauthorizedException("Phiên làm việc đã hết hạn hoặc không hợp lệ.")

        username: str = payload["sub"]
        user = AdminRepository.get_by_username(db, username)
        if not user or not user.is_active:
            raise UnauthorizedException("Tài khoản không tồn tại hoặc đã bị khóa.")

        return user
