from typing import Optional
from fastapi import Depends, Request
from sqlalchemy.orm import Session
from app.config import get_settings
from app.core.exceptions import UnauthorizedException, AppException
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
    def get_current_user(
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

    @staticmethod
    def get_current_admin(user: AdminUser = Depends(get_current_user)) -> AdminUser:
        if user.role not in ("admin", "doctor"):
            raise AppException(403, "FORBIDDEN", "Chỉ bác sĩ hoặc quản trị viên được thực hiện thao tác này.")
        return user

    @staticmethod
    def require_account_admin(user: AdminUser = Depends(get_current_user)) -> AdminUser:
        if user.role != "admin":
            raise AppException(403, "FORBIDDEN", "Chỉ quản trị viên được quản lý tài khoản.")
        return user

    @staticmethod
    def require_form_admin(user: AdminUser = Depends(get_current_user)) -> AdminUser:
        if user.role != "admin":
            raise AppException(403, "FORBIDDEN", "Chỉ quản trị viên được thay đổi cấu trúc biểu mẫu.")
        return user
