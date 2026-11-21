#!/usr/bin/env bash
set -euo pipefail
umask 077
cd "$(dirname "$0")/.."

backup_dir=${BACKUP_DIR:-/opt/ovarian-survey/backups}
if [[ -z ${BACKUP_DIR:-} && ! -d /opt/ovarian-survey ]]; then
    backup_dir=./backups
fi

mkdir -p "$backup_dir"
backup_file="${backup_dir}/ovarian_$(date +'%Y-%m-%d_%H%M%S').dump"
tmp_file=$(mktemp "${backup_file}.XXXXXX")
trap 'rm -f -- "$tmp_file"' EXIT

# Verify the target even if the application is stopped after a failed upgrade.
database=$(docker compose exec -T postgres sh -c 'printf "%s" "$POSTGRES_DB"')
if [[ -n $(docker compose ps --status running -q backend) ]]; then
    backend_command=(exec -T backend)
else
    backend_command=(run --rm --no-deps -T backend)
fi
docker compose "${backend_command[@]}" python -c 'import sys; from app.database import engine; u=engine.url; sys.exit(0 if u.get_backend_name()=="postgresql" and u.host=="postgres" and u.database==sys.argv[1] and (u.port or 5432)==5432 else "Database ứng dụng không khớp PostgreSQL Compose. Sao lưu đúng database bên ngoài trước khi nâng cấp; bản sao nhầm đã bị chặn.")' "$database"

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp_file"
docker compose exec -T postgres pg_restore --list < "$tmp_file" >/dev/null
mv -- "$tmp_file" "$backup_file"
echo "Đã sao lưu PostgreSQL vào $backup_file"
