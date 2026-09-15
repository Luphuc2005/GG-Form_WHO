#!/usr/bin/env bash
# ==============================================================================
# SCRIPT SAO LƯU CƠ SỞ DỮ LIỆU POSTGRESQL (DATABASE BACKUP)
# ==============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

# Nạp cấu hình từ .env nếu có
if [ -f .env ]; then
    export $(grep -v '^#' .env | xargs -d '\n')
fi

POSTGRES_DB=${POSTGRES_DB:-ovarian_survey}
POSTGRES_USER=${POSTGRES_USER:-survey_user}

# Thư mục lưu trữ bản sao lưu trên máy chủ Host (không nằm trong container)
BACKUP_DIR=${BACKUP_DIR:-/opt/ovarian-survey/backups}
if [ ! -d "/opt/ovarian-survey" ] && [ "$BACKUP_DIR" = "/opt/ovarian-survey/backups" ]; then
    BACKUP_DIR="./backups"
fi

mkdir -p "$BACKUP_DIR"

TIMESTAMP=$(date +"%Y-%m-%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/ovarian_${TIMESTAMP}.dump"

echo "=================================================================="
echo "          SAO LƯU CƠ SỞ DỮ LIỆU POSTGRESQL                        "
echo "=================================================================="
echo "Cơ sở dữ liệu : $POSTGRES_DB"
echo "Đích sao lưu  : $BACKUP_FILE"

# Thực hiện pg_dump định dạng custom format (-Fc)
docker exec -t ovarian_survey_postgres pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc > "$BACKUP_FILE"

FILESIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "✅ Sao lưu hoàn tất thành công!"
echo "   Dung lượng tệp: $FILESIZE"
echo "   Đường dẫn tệp : $BACKUP_FILE"
echo "=================================================================="
