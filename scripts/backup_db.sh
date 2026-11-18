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

docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > "$tmp_file"
mv -- "$tmp_file" "$backup_file"
echo "Đã sao lưu PostgreSQL vào $backup_file"
