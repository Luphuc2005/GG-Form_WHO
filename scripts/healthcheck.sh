#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

binding=$(docker compose port nginx 80)
host=${binding%:*}
port=${binding##*:}
case "$host" in
    0.0.0.0) host=127.0.0.1 ;;
    '[::]' | '::') host='[::1]' ;;
esac
base_url="http://${host}:${port}"

docker compose exec -T backend python -m app.commands.check_deployment
docker compose exec -T worker python -m app.commands.run_worker --healthcheck
docker compose exec -T backup /bin/sh /scripts/backup_loop.sh --healthcheck

for path in / /health/live /health/ready /api/v1/forms/current; do
    curl --fail --silent --show-error --max-time 15 "${base_url}${path}" >/dev/null
    echo "OK ${path}"
done

asset=$(curl --fail --silent --show-error --max-time 15 "$base_url/" | sed -n 's/.*src="\(\/assets\/[^" ]*\.js\)".*/\1/p' | head -n 1)
if [[ -z "$asset" ]]; then
    echo "Không tìm thấy JavaScript của frontend đã build." >&2
    exit 1
fi
curl --fail --silent --show-error --max-time 15 "${base_url}${asset}" >/dev/null
echo "OK frontend asset, migration, worker và backup"
