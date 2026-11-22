#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ ! -f .env ]]; then
    echo "Tạo .env từ .env.example và điền cấu hình máy chủ trước khi triển khai." >&2
    exit 1
fi

docker compose config --quiet

# Preserve old image references before a build can replace their tags.
deployment_id=$(date -u +'%Y%m%d-%H%M%S')
recovery_dir="./backups/deploy-${deployment_id}"
mkdir -p "$recovery_dir"
chmod 700 "$recovery_dir"
git rev-parse HEAD > "$recovery_dir/checkout.txt"
for service in backend nginx; do
    container_id=$(docker compose ps -aq "$service")
    if [[ -n "$container_id" ]]; then
        image_id=$(docker inspect --format '{{.Image}}' "$container_id")
        docker image tag "$image_id" "ovarian-survey-recovery-${service}:${deployment_id}"
        printf '%s\n' "ovarian-survey-recovery-${service}:${deployment_id}" > "$recovery_dir/${service}-image.txt"
    fi
done

docker compose build
docker compose up -d --wait --wait-timeout 90 postgres

# Validate against the new image while the old app is still serving.
docker compose run --rm --no-deps backend python -m app.commands.check_deployment --before-migration
bash scripts/backup_db.sh

echo "Dừng ứng dụng để chạy migration."
docker compose stop nginx backend worker backup
trap 'echo "Triển khai chưa hoàn tất. Giữ database/volume và bản sao trong backups; xem UPDATE_GUIDE.md trước khi mở lại. Không chạy down -v hoặc stamp head." >&2' ERR
docker compose run --rm --no-deps backend alembic upgrade head
docker compose run --rm --no-deps backend python -m app.commands.import_form form-definitions/ovarian-pathology-v1.json
docker compose run --rm --no-deps backend python -m app.commands.create_admin
docker compose run --rm --no-deps backend python -m app.commands.check_deployment

docker compose up -d --wait --wait-timeout 90
trap 'echo "Ứng dụng đã khởi động nhưng bước kiểm tra cuối chưa đạt. Xem lỗi phía trên rồi chạy lại bash scripts/healthcheck.sh; giữ nguyên database và volume." >&2' ERR
bash scripts/healthcheck.sh
trap - ERR
