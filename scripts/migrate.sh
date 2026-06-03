#!/usr/bin/env bash
#
# Minimal forward-only migration runner via `docker compose exec psql`.
# Replaces `golang-migrate` until the LC_UUID issue on macOS 26.x is sorted.
#
# Tracks applied versions in `schema_migrations(version TEXT PRIMARY KEY)`.
# Applies every `server/migrations/NNN_*.up.sql` not yet recorded.
#
# Usage:
#   ./scripts/migrate.sh up          # apply pending
#   ./scripts/migrate.sh down 1      # roll back last N (one file at a time)
#   ./scripts/migrate.sh status      # show applied vs pending
#
# Env:
#   POSTGRES_SERVICE  docker compose service name (default: postgres)
#   POSTGRES_USER     (default: wiseflow)
#   POSTGRES_DB       (default: wiseflow)

set -euo pipefail

SERVICE="${POSTGRES_SERVICE:-postgres}"
PGUSER="${POSTGRES_USER:-wiseflow}"
PGDB="${POSTGRES_DB:-wiseflow}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"
mig_dir="$repo_root/server/migrations"

psql() {
  docker compose exec -T "$SERVICE" psql -U "$PGUSER" -d "$PGDB" -v ON_ERROR_STOP=1 -q "$@"
}

ensure_table() {
  psql -c "CREATE TABLE IF NOT EXISTS schema_migrations (
             version TEXT PRIMARY KEY,
             applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
           );" >/dev/null
}

applied_versions() {
  psql -t -A -c "SELECT version FROM schema_migrations ORDER BY version;"
}

list_up_files() {
  find "$mig_dir" -maxdepth 1 -name '[0-9]*_*.up.sql' -type f | sort
}

list_down_files() {
  find "$mig_dir" -maxdepth 1 -name '[0-9]*_*.down.sql' -type f | sort -r
}

version_from() {
  local f="$1"
  basename "$f" | sed -E 's/^([0-9]+)_.*/\1/'
}

cmd_up() {
  ensure_table
  local applied
  applied="$(applied_versions || true)"
  local count=0
  # 用数组而不是 while-read-from-process-subst, 否则 docker compose exec 会
  # 偷走 stdin, 导致每跑一次只过一个 migration.
  local files=()
  while IFS= read -r f; do files+=("$f"); done < <(list_up_files)
  for f in "${files[@]}"; do
    local v
    v="$(version_from "$f")"
    if grep -qx "$v" <<<"$applied"; then
      echo "skip  $v $(basename "$f") (already applied)"
      continue
    fi
    echo "apply $v $(basename "$f")"
    psql <"$f" >/dev/null
    psql -c "INSERT INTO schema_migrations(version) VALUES ('$v');" >/dev/null
    count=$((count + 1))
  done
  echo "done. applied $count new migration(s)."
}

cmd_down() {
  ensure_table
  local n="${1:-1}"
  local rolled=0
  while IFS= read -r f; do
    if [ "$rolled" -ge "$n" ]; then break; fi
    local v
    v="$(version_from "$f")"
    local applied
    applied="$(psql -t -A -c "SELECT 1 FROM schema_migrations WHERE version='$v';")"
    if [ -z "$applied" ]; then
      continue
    fi
    echo "revert $v $(basename "$f")"
    psql <"$f" >/dev/null
    psql -c "DELETE FROM schema_migrations WHERE version='$v';" >/dev/null
    rolled=$((rolled + 1))
  done < <(list_down_files)
  echo "done. reverted $rolled migration(s)."
}

cmd_status() {
  ensure_table
  local applied
  applied="$(applied_versions || true)"
  printf "%-8s %-12s %s\n" "STATE" "VERSION" "FILE"
  while IFS= read -r f; do
    local v
    v="$(version_from "$f")"
    if grep -qx "$v" <<<"$applied"; then
      printf "%-8s %-12s %s\n" "applied" "$v" "$(basename "$f")"
    else
      printf "%-8s %-12s %s\n" "pending" "$v" "$(basename "$f")"
    fi
  done < <(list_up_files)
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down "${2:-1}" ;;
  status) cmd_status ;;
  *)      echo "usage: $0 [up|down N|status]" >&2; exit 2 ;;
esac
