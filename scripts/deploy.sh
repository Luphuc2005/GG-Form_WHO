#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "Tạo .env từ .env.example và điền cấu hình máy chủ trước khi triển khai." >&2
    exit 1
fi

docker compose config --quiet
docker compose build
docker compose up -d --wait --wait-timeout 90 postgres

echo "Dừng ứng dụng để chạy migration."
docker compose stop nginx backend
docker compose run --rm backend alembic upgrade head
docker compose run --rm backend python -m app.commands.import_form form-definitions/ovarian-pathology-v1.json
docker compose run --rm backend python -m app.commands.create_admin

docker compose up -d --wait --wait-timeout 90
bash scripts/healthcheck.sh
