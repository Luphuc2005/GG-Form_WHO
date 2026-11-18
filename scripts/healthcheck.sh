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

for path in / /health/live /health/ready /api/v1/forms/current; do
    curl --fail --silent --show-error --max-time 15 "${base_url}${path}" >/dev/null
    echo "OK ${path}"
done
