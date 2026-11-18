#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || ! -f $1 ]]; then
    echo "Cách dùng: bash scripts/restore_db.sh /duong-dan/ban-sao.dump" >&2
    exit 1
fi

# Open before changing directory so relative paths work from the caller's cwd.
exec 3< "$1"
cd "$(dirname "$0")/.."

echo "Khôi phục từ $1 sẽ thay thế dữ liệu PostgreSQL hiện tại."
read -r -p "Nhập DONG_Y để tiếp tục: " confirm
if [[ "$confirm" != DONG_Y ]]; then
    echo "Đã hủy khôi phục."
    exit 0
fi

docker compose exec -T postgres sh -c \
    'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --single-transaction --exit-on-error' <&3
echo "Đã khôi phục PostgreSQL."
