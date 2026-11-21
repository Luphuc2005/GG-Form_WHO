#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 1 || ! -f $1 ]]; then
    echo "Cách dùng: bash scripts/restore_db.sh /duong-dan/ban-sao.dump" >&2
    exit 1
fi

# Open before changing directory so relative paths work from the caller's cwd.
exec 3< "$1"
cd "$(dirname "$0")/.."

# Decode the entire archive before confirmation or stopping the application.
# Restore the dedicated application schema in one transaction: --clean alone
# cannot remove newer tables absent from an old archive (for example exports).
umask 077
restore_sql=$(mktemp)
trap 'rm -f -- "$restore_sql"' EXIT
printf 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;\n' > "$restore_sql"
docker compose exec -T postgres pg_restore --no-owner --no-acl --file=- <&3 >> "$restore_sql"

echo "Khôi phục từ $1 sẽ thay thế dữ liệu PostgreSQL hiện tại."
read -r -p "Nhập DONG_Y để tiếp tục: " confirm
if [[ "$confirm" != DONG_Y ]]; then
    echo "Đã hủy khôi phục."
    exit 0
fi

bash scripts/backup_db.sh
services=$(docker compose config --services)
writers=()
for service in nginx backend worker backup; do
    if grep -qx "$service" <<< "$services"; then writers+=("$service"); fi
done
if [[ ${#writers[@]} -gt 0 ]]; then docker compose stop "${writers[@]}"; fi

docker compose exec -T postgres sh -c \
    'psql -X -U "$POSTGRES_USER" -d "$POSTGRES_DB" --single-transaction --set ON_ERROR_STOP=1' < "$restore_sql" >/dev/null
echo "Đã khôi phục PostgreSQL. Ứng dụng vẫn dừng để tránh chạy sai phiên bản schema."
echo "Kiểm tra commit cần dùng, rồi chạy bash scripts/deploy.sh để migration và mở lại đầy đủ."
