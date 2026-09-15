#!/usr/bin/env bash
# ==============================================================================
# SCRIPT KIỂM TRA MÔI TRƯỜNG MÁY CHỦ (READ-ONLY DIAGNOSTICS)
# ==============================================================================
# Script này CHỈ KIỂM TRA và hiển thị thông số hệ thống, hoàn toàn KHÔNG THAY ĐỔI
# bất kỳ cấu hình hay cài đặt nào trên máy chủ.
# ==============================================================================

set -e

echo "=================================================================="
echo "          KIỂM TRA CẤU HÌNH MÁY CHỦ TRIỂN KHAI KHẢO SÁT            "
echo "=================================================================="

# 1. Hệ điều hành
echo -e "\n[1] HỆ ĐIỀU HÀNH:"
if [ -f /etc/os-release ]; then
    grep PRETTY_NAME /etc/os-release | cut -d= -f2 | tr -d '"'
else
    uname -s -r
fi

# 2. CPU & RAM
echo -e "\n[2] PHẦN CỨNG (CPU & RAM):"
if command -v nproc >/dev/null 2>&1; then
    echo "Số lõi CPU (vCPU): $(nproc)"
fi
if command -v free >/dev/null 2>&1; then
    free -h | awk '/^Mem:/ {print "Tổng RAM: " $2 " | Đang dùng: " $3 " | Còn trống: " $4}'
fi

# 3. Dung lượng ổ đĩa (Disk Space)
echo -e "\n[3] DUNG LƯỢNG Ổ ĐĨA:"
df -h / | awk 'NR==2 {print "Ổ cứng gốc (/): Tổng: " $2 " | Đã dùng: " $3 " (" $5 ") | Khả dụng: " $4}'

# 4. Kiểm tra Docker & Docker Compose
echo -e "\n[4] DOCKER & DOCKER COMPOSE:"
if command -v docker >/dev/null 2>&1; then
    docker --version
else
    echo "⚠️  Docker: CHƯA CÀI ĐẶT"
fi

if docker compose version >/dev/null 2>&1; then
    docker compose version
elif command -v docker-compose >/dev/null 2>&1; then
    docker-compose --version
else
    echo "⚠️  Docker Compose: CHƯA CÀI ĐẶT"
fi

# 5. Kiểm tra trạng thái các cổng mạng quan trọng
echo -e "\n[5] TRẠNG THÁI CÁC CỔNG MẠNG (PORT USAGE):"
check_port() {
    local port=$1
    local name=$2
    if command -v ss >/dev/null 2>&1; then
        if ss -lnt | grep -q ":$port "; then
            local proc=$(ss -lntp 2>/dev/null | grep ":$port " | awk '{print $NF}' || echo "đang chạy")
            echo "   - Cổng $port ($name): ĐANG ĐƯỢC SỬ DỤNG [$proc]"
        else
            echo "   - Cổng $port ($name): ĐANG TRỐNG (Khả dụng)"
        fi
    elif command -v netstat >/dev/null 2>&1; then
        if netstat -tuln | grep -q ":$port "; then
            echo "   - Cổng $port ($name): ĐANG ĐƯỢC SỬ DỤNG"
        else
            echo "   - Cổng $port ($name): ĐANG TRỐNG (Khả dụng)"
        fi
    else
        echo "   - Cổng $port ($name): Không có công cụ ss/netstat để kiểm tra"
    fi
}

check_port 80 "HTTP công cộng"
check_port 443 "HTTPS công cộng"
check_port 8080 "Cổng phụ ứng dụng (Proxy nội bộ)"
check_port 5432 "PostgreSQL"

echo -e "\n=================================================================="
echo "KHUYẾN NGHỊ DEPLOY:"
if command -v ss >/dev/null 2>&1 && ss -lnt | grep -q -E ':(80|443) '; then
    echo "👉 Máy chủ ĐÃ CÓ dịch vụ chạy trên cổng 80/443 (VD: Nginx/Apache của trường)."
    echo "   -> Hãy chọn KỊCH BẢN B trong DEPLOYMENT_FOR_TEACHER.md: Cấu hình cổng"
    echo "      ứng dụng là 8080 (APP_HTTP_PORT=8080) và reverse-proxy qua Nginx trường."
else
    echo "👉 Cổng 80/443 đang trống."
    echo "   -> Có thể triển khai trực tiếp theo KỊCH BẢN A độc lập."
fi
echo "=================================================================="
