#!/usr/bin/env bash
# ==============================================================================
# SCRIPT TỰ ĐỘNG TRIỂN KHAI TOÀN BỘ HỆ THỐNG KHẢO SÁT (ONE-COMMAND DEPLOY)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

echo "=================================================================="
echo "      BẮT ĐẦU TRIỂN KHAI HỆ THỐNG KHẢO SÁT GPB U BUỒNG TRỨNG      "
echo "=================================================================="

# 1. Kiểm tra Docker
if ! command -v docker >/dev/null 2>&1; then
    echo "❌ LỖI: Máy chủ chưa cài đặt Docker. Vui lòng cài Docker trước khi tiếp tục."
    exit 1
fi

# 2. Kiểm tra Docker Compose
DOCKER_COMPOSE="docker compose"
if ! docker compose version >/dev/null 2>&1; then
    if command -v docker-compose >/dev/null 2>&1; then
        DOCKER_COMPOSE="docker-compose"
    else
        echo "❌ LỖI: Máy chủ chưa cài đặt Docker Compose."
        exit 1
    fi
fi

# 3. Kiểm tra tệp .env
if [ ! -f .env ]; then
    echo "❌ LỖI: Chưa tìm thấy tệp .env!"
    echo "   Vui lòng tạo tệp cấu hình trước:  cp .env.example .env"
    echo "   Sau đó chỉnh sửa mật khẩu và thông số trong .env rồi chạy lại script này."
    exit 1
fi

# Nạp biến môi trường từ .env
export $(grep -v '^#' .env | xargs -d '\n')

echo "✅ Kiểm tra môi trường hoàn tất."

# 4. Xây dựng Docker Images
echo -e "\n📦 [1/6] Đang biên dịch Docker images (Frontend & Backend)..."
$DOCKER_COMPOSE build

# 5. Khởi động PostgreSQL trước
echo -e "\n🐘 [2/6] Khởi động cơ sở dữ liệu PostgreSQL..."
$DOCKER_COMPOSE up -d postgres

# 6. Chờ PostgreSQL sẵn sàng (Healthcheck loop an toàn)
echo "⏳ Chờ PostgreSQL khởi tạo hoàn tất..."
RETRY_COUNT=0
MAX_RETRIES=30
until [ $($DOCKER_COMPOSE ps -q postgres | xargs docker inspect -f '{{.State.Health.Status}}' 2>/dev/null || echo "unhealthy") = "healthy" ]; do
    RETRY_COUNT=$((RETRY_COUNT + 1))
    if [ $RETRY_COUNT -ge $MAX_RETRIES ]; then
        echo "❌ LỖI: PostgreSQL không thể khởi động sau $MAX_RETRIES lần thử. Xem logs: $DOCKER_COMPOSE logs postgres"
        exit 1
    fi
    sleep 2
done
echo "✅ PostgreSQL đã sẵn sàng nhận kết nối!"

# 7. Chạy Alembic Migration
echo -e "\n🔄 [3/6] Chạy cập nhật cấu trúc cơ sở dữ liệu (Alembic Migration)..."
$DOCKER_COMPOSE run --rm backend alembic upgrade head
echo "✅ Cập nhật cơ sở dữ liệu thành công!"

# 8. Import / Publish Form Schema
echo -e "\n📋 [4/6] Kiểm tra và cập nhật biểu mẫu khảo sát WHO v1..."
$DOCKER_COMPOSE run --rm backend python -m app.commands.import_form form-definitions/ovarian-pathology-v1.json || true

# Khởi tạo tài khoản quản trị viên nếu chưa có
$DOCKER_COMPOSE run --rm backend python -m app.commands.create_admin || true

# 9. Khởi động toàn bộ các dịch vụ (Backend + Nginx)
echo -e "\n🚀 [5/6] Khởi chạy toàn bộ hệ thống..."
$DOCKER_COMPOSE up -d

# 10. Chờ ứng dụng sẵn sàng và chạy Healthcheck
echo -e "\n🩺 [6/6] Kiểm tra trạng thái hệ thống sau triển khai..."
sleep 5

HOST_PORT=${APP_HTTP_PORT:-8080}
HEALTH_URL="http://127.0.0.1:${HOST_PORT}/health/ready"

HEALTH_STATUS="fail"
for i in {1..15}; do
    if curl -s -f "$HEALTH_URL" >/dev/null 2>&1; then
        HEALTH_STATUS="ok"
        break
    fi
    sleep 2
done

echo ""
echo "=================================================================="
if [ "$HEALTH_STATUS" = "ok" ]; then
    echo "🎉 TRIỂN KHAI THÀNH CÔNG HỆ THỐNG KHẢO SÁT!"
    echo ""
    echo "   📍 Khảo sát (Người dùng):   http://<IP_MAY_CHU>:${HOST_PORT}/"
    if [ -n "${DOMAIN:-}" ]; then
        echo "   📍 Tên miền đã cấu hình:    https://${DOMAIN}/"
    fi
    echo "   🔐 Trang quản trị (Admin):  http://<IP_MAY_CHU>:${HOST_PORT}/admin"
    echo "   🩺 Kiểm tra sức khỏe:       http://<IP_MAY_CHU>:${HOST_PORT}/health/ready"
    echo ""
    echo "   Tài khoản Admin mặc định:   ${ADMIN_USERNAME:-admin}"
    echo "   Mật khẩu:                   (Đã cấu hình trong tệp .env)"
else
    echo "⚠️ CẢNH BÁO: Không nhận được phản hồi 200 từ $HEALTH_URL."
    echo "   Vui lòng kiểm tra logs bằng lệnh:"
    echo "   $DOCKER_COMPOSE logs -f"
fi
echo "=================================================================="
