#!/bin/sh
# Nightly off-site mirror of the Kindred catalog.
#
# Postgres stays on the NAS, next to the API and the originals, because that is
# where the queries are cheap. This gives the off-site safety of a managed
# database without paying network latency on every request: once a night the
# live catalog is dumped and replayed into a second Postgres elsewhere.
#
# The dump is taken with --clean --if-exists, so each run drops and recreates
# the mirror's objects. The mirror is a replica, never a second source of
# truth: anything written there directly is destroyed by the next run.
#
#   BACKUP_DATABASE_URL=postgresql://...  ./backup_database.sh
#
# Exits non-zero on any failure so cron mail (or the log) shows the problem.

set -eu

COMPOSE="${COMPOSE_FILE:-/volume1/docker/Files/kindred/deploy/ugreen/docker-compose.yml}"
ENV_FILE="${ENV_FILE:-/volume1/docker/Files/kindred/deploy/ugreen/.env}"
BACKUP_DIR="${BACKUP_DIR:-/volume1/docker/Files/kindred/deploy/ugreen/data/backups}"
KEEP="${KEEP:-7}"

# Read BACKUP_DATABASE_URL from the environment, else from the deployment .env.
if [ -z "${BACKUP_DATABASE_URL:-}" ] && [ -f "$ENV_FILE" ]; then
    BACKUP_DATABASE_URL=$(grep -m1 '^BACKUP_DATABASE_URL=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)
fi

log() { echo "$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"; }

mkdir -p "$BACKUP_DIR"
STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
DUMP="$BACKUP_DIR/kindred-$STAMP.sql.gz"

log "dumping live catalog"
# pg_dump runs inside the database container, so its version always matches the
# server and no client tooling is needed on the NAS itself.
docker compose -f "$COMPOSE" exec -T database \
    pg_dump -U kindred -d kindred --clean --if-exists --no-owner --no-privileges \
    | gzip -6 > "$DUMP.partial"
mv "$DUMP.partial" "$DUMP"
log "wrote $DUMP ($(du -h "$DUMP" | cut -f1))"

if [ -z "${BACKUP_DATABASE_URL:-}" ]; then
    log "BACKUP_DATABASE_URL not set — local dump kept, no off-site mirror"
else
    log "replaying into the off-site mirror"
    # ON_ERROR_STOP so a partial restore fails loudly instead of leaving the
    # mirror half-populated and looking healthy.
    gunzip -c "$DUMP" | docker compose -f "$COMPOSE" exec -T \
        -e PGURL="$BACKUP_DATABASE_URL" database \
        sh -c 'psql "$PGURL" -v ON_ERROR_STOP=1 -q' >/dev/null
    log "mirror updated"
fi

# Retain the most recent KEEP dumps; older ones are redundant with the mirror.
COUNT=$(ls -1 "$BACKUP_DIR"/kindred-*.sql.gz 2>/dev/null | wc -l | tr -d ' ')
if [ "$COUNT" -gt "$KEEP" ]; then
    ls -1t "$BACKUP_DIR"/kindred-*.sql.gz | tail -n +$((KEEP + 1)) | while read -r old; do
        log "pruning $(basename "$old")"
        rm -f "$old"
    done
fi

log "done"
