#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ $(git branch --show-current) != main ]]; then
    echo "Chuyển checkout triển khai sang nhánh main trước khi cập nhật." >&2
    exit 1
fi

# Keep the previous database snapshot before pulling and migrating.
bash scripts/backup_db.sh
git pull --ff-only origin main
bash scripts/deploy.sh
