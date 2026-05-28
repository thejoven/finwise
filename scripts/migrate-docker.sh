#!/bin/sh
# Forward-only migration runner for the docker-compose deployment.
#
# 用法 (从宿主):
#   docker compose --profile migrate run --rm migrator              # 等价于 up
#   docker compose --profile migrate run --rm migrator status
#   docker compose --profile migrate run --rm migrator down 1
#
# 跑在 postgres:16-alpine 里 (有 psql client), 通过 PGHOST 等环境变量连
# api 同网络的 postgres 服务. 逻辑跟 scripts/migrate.sh 一致, 只是不再走
# `docker compose exec`, 改直接 psql.

set -eu

MIG_DIR="${MIG_DIR:-/migrations}"
PSQL_BASE="psql -v ON_ERROR_STOP=1 -q"

ensure_table() {
  $PSQL_BASE -c "CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );" >/dev/null
}

applied_versions() {
  $PSQL_BASE -t -A -c "SELECT version FROM schema_migrations ORDER BY version;"
}

version_from() {
  basename "$1" | sed -E 's/^([0-9]+)_.*/\1/'
}

cmd_up() {
  ensure_table
  applied=$(applied_versions || true)
  count=0
  for f in "$MIG_DIR"/[0-9]*_*.up.sql; do
    [ -f "$f" ] || continue
    v=$(version_from "$f")
    if echo "$applied" | grep -qx "$v" >/dev/null 2>&1; then
      echo "skip  $v $(basename "$f")"
      continue
    fi
    echo "apply $v $(basename "$f")"
    $PSQL_BASE -f "$f" >/dev/null
    $PSQL_BASE -c "INSERT INTO schema_migrations(version) VALUES ('$v');" >/dev/null
    count=$((count + 1))
  done
  echo "done. applied $count new migration(s)."
}

cmd_down() {
  ensure_table
  n="${1:-1}"
  rolled=0
  # 倒序遍历 down 文件.
  for f in $(ls -1r "$MIG_DIR"/[0-9]*_*.down.sql 2>/dev/null || true); do
    [ "$rolled" -ge "$n" ] && break
    v=$(version_from "$f")
    is_applied=$($PSQL_BASE -t -A -c "SELECT 1 FROM schema_migrations WHERE version='$v';")
    [ -z "$is_applied" ] && continue
    echo "revert $v $(basename "$f")"
    $PSQL_BASE -f "$f" >/dev/null
    $PSQL_BASE -c "DELETE FROM schema_migrations WHERE version='$v';" >/dev/null
    rolled=$((rolled + 1))
  done
  echo "done. reverted $rolled migration(s)."
}

cmd_status() {
  ensure_table
  applied=$(applied_versions || true)
  printf '%-8s %-12s %s\n' "STATE" "VERSION" "FILE"
  for f in "$MIG_DIR"/[0-9]*_*.up.sql; do
    [ -f "$f" ] || continue
    v=$(version_from "$f")
    if echo "$applied" | grep -qx "$v" >/dev/null 2>&1; then
      printf '%-8s %-12s %s\n' "applied" "$v" "$(basename "$f")"
    else
      printf '%-8s %-12s %s\n' "pending" "$v" "$(basename "$f")"
    fi
  done
}

case "${1:-up}" in
  up)     cmd_up ;;
  down)   cmd_down "${2:-1}" ;;
  status) cmd_status ;;
  *)      echo "usage: migrate [up|down N|status]" >&2; exit 2 ;;
esac
