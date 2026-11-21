#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $(git branch --show-current) != main ]]; then
    echo "Chuyển checkout triển khai sang nhánh main trước khi cập nhật." >&2
    exit 1
fi

if [[ -n $(git status --porcelain --untracked-files=no) ]]; then
    echo "Checkout máy chủ đang có sửa đổi. Giữ lại và đối chiếu trước khi cập nhật; không tự reset hoặc ghi đè cấu hình." >&2
    exit 1
fi

# Keep the previous database snapshot before pulling and migrating.
bash scripts/backup_db.sh
mkdir -p ./backups
git rev-parse HEAD > ./backups/last-checkout-before-update.txt
git pull --ff-only origin main
bash scripts/deploy.sh
