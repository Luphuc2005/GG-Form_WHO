#!/usr/bin/env bash
# ==============================================================================
# SCRIPT KIỂM TRA SỨC KHỎE HỆ THỐNG SAU TRIỂN KHAI (SYSTEM HEALTHCHECK)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs -d '\n')
fi

PORT=${APP_HTTP_PORT:-8080}
BASE_URL="http://127.0.0.1:${PORT}"

echo "Đang kiểm tra kết nối tới các dịch vụ tại ${BASE_URL}..."

# 1. Check Root (Frontend index.html)
if ! curl -s -f "${BASE_URL}/" >/dev/null; then
    echo "❌ Lỗi: Không thể truy cập Frontend (${BASE_URL}/)"
    exit 1
fi

# 2. Check Backend Liveness
if ! curl -s -f "${BASE_URL}/health/live" >/dev/null; then
    echo "❌ Lỗi: Backend liveness probe thất bại (${BASE_URL}/health/live)"
    exit 1
fi

# 3. Check Backend Readiness (Database connectivity)
READY_RES=$(curl -s -f "${BASE_URL}/health/ready" || echo "FAIL")
if [[ "$READY_RES" == *"connected"* ]]; then
    echo ""
    echo "========================================"
    echo "   Ovarian Pathology Survey             "
    echo "   STATUS: HEALTHY                      "
    echo "                                        "
    echo "   Survey:                              "
    if [ -n "${DOMAIN:-}" ]; then
        echo "   https://${DOMAIN}/                   "
    else
        echo "   ${BASE_URL}/                         "
    fi
    echo "                                        "
    echo "   Admin:                               "
    if [ -n "${DOMAIN:-}" ]; then
        echo "   https://${DOMAIN}/admin              "
    else
        echo "   ${BASE_URL}/admin                    "
    fi
    echo "========================================"
    exit 0
else
    echo "❌ Lỗi: Database readiness check thất bại. Chi tiết: $READY_RES"
    exit 1
fi
