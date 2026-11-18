import argparse
import sys
from app.config import get_settings
from app.core.security import hash_password
from app.database import SessionLocal
from app.repositories.admin_repo import AdminRepository

settings = get_settings()


def bootstrap_admin(username: str | None = None, password: str | None = None, reset: bool = False) -> None:
    admin_user = username or settings.ADMIN_USERNAME
    admin_pass = password or settings.ADMIN_PASSWORD

    if not admin_user or not admin_pass:
        print("LỖI: Chưa cung cấp tên đăng nhập hoặc mật khẩu quản trị viên.")
        sys.exit(1)

    db = SessionLocal()
    try:
        if AdminRepository.get_by_username(db, admin_user) and not reset:
            print("Tài khoản quản trị đã tồn tại; giữ nguyên mật khẩu và quyền.")
            return
        pw_hash = hash_password(admin_pass)
        user = AdminRepository.create_or_update(db, admin_user, pw_hash)
        print(f"Quản trị viên '{user.username}' đã được thiết lập/cập nhật thành công.")
    finally:
        db.close()


def main():
    parser = argparse.ArgumentParser(description="Tạo hoặc cập nhật tài khoản quản trị viên")
    parser.add_argument("--username", help="Tên đăng nhập (mặc định lấy từ ENV ADMIN_USERNAME)")
    parser.add_argument("--password", help="Mật khẩu (mặc định lấy từ ENV ADMIN_PASSWORD)")
    parser.add_argument("--reset", action="store_true", help="Chủ động đặt lại mật khẩu tài khoản đã tồn tại")
    args = parser.parse_args()

    bootstrap_admin(args.username, args.password, reset=args.reset)


if __name__ == "__main__":
    main()
