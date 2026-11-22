#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

# Docker can return both IPv4 and IPv6 bindings, one per line. Never place
# that whole output in a URL. Prefer IPv4, retaining IPv6-only deployments.
bindings=$(docker compose port nginx 80)
base_url=""
while IFS= read -r binding; do
    binding=${binding%$'\r'}
    [[ $binding =~ ^(.+):([0-9]{1,5})$ ]] || continue
    host=${BASH_REMATCH[1]}
    port=${BASH_REMATCH[2]}
    (( 10#$port >= 1 && 10#$port <= 65535 )) || continue
    if [[ $host =~ ^([0-9]{1,3}\.){3}[0-9]{1,3}$ ]]; then
        [[ $host != 0.0.0.0 ]] || host=127.0.0.1
        base_url="http://${host}:${port}"
        break
    elif [[ $host =~ ^\[[0-9a-fA-F:.%]+\]$ || ( $host == *:* && $host =~ ^[0-9a-fA-F:.%]+$ ) ]]; then
        host=${host#[}
        host=${host%]}
        [[ $host != :: ]] || host=::1
        [[ -n $base_url ]] || base_url="http://[${host}]:${port}"
    fi
done <<< "$bindings"
if [[ -z $base_url ]]; then
    echo "Không tìm thấy địa chỉ/cổng HTTP hợp lệ của nginx. Kiểm tra docker compose ps và docker compose port nginx 80." >&2
    exit 1
fi

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
