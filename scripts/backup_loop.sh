#!/bin/sh
# Executed inside the PostgreSQL backup sidecar, never on the Windows host.
set -eu
umask 077

interval_hours=${BACKUP_INTERVAL_HOURS:-24}
keep_days=${BACKUP_KEEP_DAYS:-7}
case "$interval_hours:$keep_days" in *[!0-9:]*|:*|*:) exit 2 ;; esac
[ "$interval_hours" -ge 1 ] && [ "$interval_hours" -le 168 ]
[ "$keep_days" -ge 1 ] && [ "$keep_days" -le 365 ]

if [ "${1:-}" = "--healthcheck" ]; then
    [ -f /backups/last-success ]
    last_success=$(cat /backups/last-success)
    case "$last_success" in ''|*[!0-9]*) exit 1 ;; esac
    [ "$(($(date +%s) - last_success))" -lt "$((interval_hours * 3600 + 3600))" ]
    exit
fi

mkdir -p /backups
if [ -n "${APPLICATION_DATABASE_URL:-}" ] && [ -z "${BACKUP_PGHOST:-}" ]; then
    echo "Set BACKUP_PGHOST and backup credentials to match the overridden application database." >&2
    exit 2
fi
while :; do
    stamp=$(date -u +'%Y%m%d-%H%M%S')
    temporary="/backups/who-${stamp}.partial"
    if pg_dump -Fc --file="$temporary" && pg_restore --list "$temporary" >/dev/null; then
        mv -- "$temporary" "/backups/who-${stamp}.dump"
        date +%s > /backups/last-success
        # Fixed directory and filename pattern keep retention inside this volume.
        find /backups -maxdepth 1 -type f -name 'who-*.dump' -mtime "+$keep_days" -delete
        echo "Database backup completed (UTC ${stamp})."
    else
        rm -f -- "$temporary"
        echo "Database backup failed; previous backups were preserved." >&2
    fi
    sleep "$((interval_hours * 3600))"
done
