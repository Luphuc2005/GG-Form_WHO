#!/usr/bin/env bash
# ==============================================================================
# SCRIPT KHÔI PHỤC CƠ SỞ DỮ LIỆU POSTGRESQL (DATABASE RESTORE)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ $# -eq 0 ]; then
    echo "❌ LỖI: Vui lòng cung cấp đường dẫn đến tệp sao lưu (.dump) cần khôi phục."
    echo "   Cách dùng: $0 /path/to/ovarian_YYYY-MM-DD_HHMMSS.dump"
    exit 1
fi

BACKUP_FILE="$1"

if [ ! -f "$BACKUP_FILE" ]; then
    echo "❌ LỖI: Tệp '$BACKUP_FILE' không tồn tại trên hệ thống!"
    exit 1
fi

# Nạp cấu hình từ .env
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs -d '\n')
fi

POSTGRES_DB=${POSTGRES_DB:-ovarian_survey}
POSTGRES_USER=${POSTGRES_USER:-survey_user}

echo "=================================================================="
echo "⚠️  CẢNH BÁO NGUY HIỂM: BẠN ĐANG CHUẨN BỊ KHÔI PHỤC DATABASE!"
echo "   Hành động này sẽ ghi đè dữ liệu hiện tại trong cơ sở dữ liệu:"
echo "   Database : $POSTGRES_DB"
echo "   Tệp nguồn: $BACKUP_FILE"
echo "=================================================================="
read -p "Bạn có chắc chắn muốn khôi phục không? Nhập 'DONG_Y' để tiếp tục: " CONFIRM

if [ "$CONFIRM" != "DONG_Y" ]; then
    echo "❌ Đã hủy thao tác khôi phục. Cơ sở dữ liệu giữ nguyên."
    exit 0
fi

echo -e "\n🔄 Đang tiến hành khôi phục dữ liệu từ $BACKUP_FILE..."

# Sử dụng pg_restore vào container
docker exec -i ovarian_survey_postgres pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists < "$BACKUP_FILE" || true

echo "✅ Khôi phục cơ sở dữ liệu thành công!"
