#!/usr/bin/env bash
# ==============================================================================
# SCRIPT CẬP NHẬT HỆ THỐNG AN TOÀN (SAFE UPDATE)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=================================================================="
echo "           CẬP NHẬT PHIÊN BẢN MỚI HỆ THỐNG KHẢO SÁT               "
echo "=================================================================="

DOCKER_COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
fi

# 1. Tùy chọn sao lưu cơ sở dữ liệu trước khi cập nhật
if [[ "${1:-}" == "--backup" ]] || [[ "${1:-}" == "-b" ]]; then
    echo -e "\n📦 [BẢO VỆ] Đang thực hiện sao lưu cơ sở dữ liệu trước cập nhật..."
    ./scripts/backup_db.sh
fi

# 2. Cập nhật mã nguồn mới từ Git nếu đang dùng git
if [ -d .git ]; then
    echo -e "\n⬇️ [1/4] Kéo mã nguồn mới nhất từ Git (git pull)..."
    git pull
else
    echo -e "\nℹ️ Không phát hiện thư mục .git, bỏ qua bước git pull."
fi

# 3. Biên dịch lại images
echo -e "\n🔨 [2/4] Đang biên dịch lại các images cập nhật..."
$DOCKER_COMPOSE build

# 4. Chạy migration nếu có thay đổi bảng cơ sở dữ liệu
echo -e "\n🔄 [3/4] Áp dụng các thay đổi cơ sở dữ liệu (nếu có)..."
$DOCKER_COMPOSE run --rm backend alembic upgrade head

# 5. Khởi động lại hệ thống mượt mà (Không xóa volume)
echo -e "\n🚀 [4/4] Khởi động lại các container với phiên bản mới..."
$DOCKER_COMPOSE up -d

echo -e "\n✅ Cập nhật thành công!"
$DOCKER_COMPOSE ps
