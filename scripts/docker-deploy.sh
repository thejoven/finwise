#!/usr/bin/env bash
#
# 把 repo 推到目标服务器 + docker compose 重建 + 起服务.
# 默认目标是 SERVER.md 里的 root@192.168.1.205, 也可以通过 FLASHFI_HOST 覆盖.
#
# 用法:
#   ./scripts/docker-deploy.sh                  # 推代码 + build + up
#   ./scripts/docker-deploy.sh --no-build       # 只 rsync, 不 rebuild
#   ./scripts/docker-deploy.sh --migrate        # rsync + 跑 migrator + 不重启
#   ./scripts/docker-deploy.sh --logs           # 只看 api + mastra 日志
#
# 前置:
#   - 服务器 /opt/flashfi/.env 已配好 (.env.docker.example 模板).
#   - SSH key 已加到服务器 authorized_keys.

set -euo pipefail

HOST="${FLASHFI_HOST:-root@192.168.1.205}"
REMOTE_DIR="${FLASHFI_REMOTE_DIR:-/opt/flashfi}"
SSH_OPTS="${FLASHFI_SSH_OPTS:-}"
COMPOSE="docker compose --profile prod"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

usage() {
  sed -n 's/^# \{0,1\}//p' "$0" | sed -n '/^用法:/,/^前置:/p'
}

sync_files() {
  echo "==> rsync to $HOST:$REMOTE_DIR"
  rsync -az --delete \
    --exclude '.git/' \
    --exclude '.claude/' \
    --exclude 'node_modules/' \
    --exclude 'dist/' \
    --exclude '*.tsbuildinfo' \
    --exclude '*.log' \
    --exclude '.env' \
    --exclude '.env.local' \
    --exclude 'server/bin/' \
    --exclude 'server/tmp/' \
    --exclude 'mobile/' \
    --exclude '.DS_Store' \
    -e "ssh ${SSH_OPTS}" \
    "$repo_root/" "$HOST:$REMOTE_DIR/"
}

remote() {
  # shellcheck disable=SC2086
  ssh ${SSH_OPTS} "$HOST" "cd $REMOTE_DIR && $*"
}

cmd_up() {
  sync_files
  local build_flag="--build"
  if [ "${1:-}" = "--no-build" ]; then
    build_flag=""
  fi
  echo "==> docker compose up $build_flag"
  remote "$COMPOSE up -d $build_flag"
  echo "==> running migrations"
  remote "docker compose --profile migrate run --rm migrator up"
  echo "==> tail logs (Ctrl-C to stop)"
  remote "$COMPOSE logs --tail=80 -f api mastra"
}

cmd_migrate() {
  sync_files
  remote "docker compose --profile migrate run --rm migrator up"
}

cmd_logs() {
  remote "$COMPOSE logs --tail=80 -f api mastra"
}

case "${1:-}" in
  ""|--build)     cmd_up ;;
  --no-build)     cmd_up --no-build ;;
  --migrate)      cmd_migrate ;;
  --logs)         cmd_logs ;;
  -h|--help)      usage; exit 0 ;;
  *)              echo "unknown flag: $1" >&2; usage; exit 2 ;;
esac
