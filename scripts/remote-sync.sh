#!/usr/bin/env bash
#
# remote-sync.sh — push local repo to the dev server and rebuild services.
#
# Default workflow (Go only):
#   1. rsync everything (minus node_modules / build artifacts / .env / .git)
#      to root@192.168.1.205:/opt/wiseflow/
#   2. on the server: go build → install binary → systemctl restart wiseflow-api
#   3. tail the last lines of the api log so we see the boot ok
#
# Mastra service (wiseflow-mastra.service) is NOT touched by default — Go-only
# changes don't need a mastra restart, and mastra restart costs ~5s of LLM
# warmup + NATS reconnection. Use --mastra or --all to bounce it.
#
# Usage:
#   ./scripts/remote-sync.sh              # rsync + Go rebuild + restart api
#   ./scripts/remote-sync.sh --no-build   # rsync only (docs / configs only)
#   ./scripts/remote-sync.sh --logs       # tail current api log
#   ./scripts/remote-sync.sh --mastra     # rsync + restart wiseflow-mastra (TS changes only)
#   ./scripts/remote-sync.sh --all        # rsync + Go rebuild + restart api + restart mastra
#   ./scripts/remote-sync.sh --mastra-install   # rsync + npm install + restart mastra (package.json changed)
#   ./scripts/remote-sync.sh --mastra-logs      # tail mastra log
#
# Env overrides:
#   REMOTE_HOST   (default: root@192.168.1.205)
#   REMOTE_DIR    (default: /opt/wiseflow)
#   SSH_KEY       (default: $HOME/.ssh/id_ed25519_clh_520jwenlee)

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@192.168.1.205}"
REMOTE_DIR="${REMOTE_DIR:-/opt/wiseflow}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_clh_520jwenlee}"

repo_root="$(cd "$(dirname "$0")/.." && pwd)"

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new"

remote() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$REMOTE_HOST" "$@"
}

do_rsync() {
  echo "→ rsync $repo_root → $REMOTE_HOST:$REMOTE_DIR"
  rsync -avz --delete \
    --exclude '.git/' \
    --exclude '.DS_Store' \
    --exclude '.env' \
    --exclude '*.log' \
    --exclude 'mobile/node_modules/' \
    --exclude 'mobile/.expo/' \
    --exclude 'mobile/dist/' \
    --exclude 'mastra/node_modules/' \
    --exclude 'mastra/dist/' \
    --exclude 'web-admin/node_modules/' \
    --exclude 'web-admin/dist/' \
    --exclude 'server/ent/' \
    -e "ssh $SSH_OPTS" \
    "$repo_root/" "$REMOTE_HOST:$REMOTE_DIR/"
}

do_build_restart() {
  echo "→ build + restart wiseflow-api on $REMOTE_HOST"
  remote 'set -e
    cd /opt/wiseflow/server
    /usr/local/go/bin/go build -o /opt/wiseflow/bin/wiseflow-api ./cmd/api
    systemctl restart wiseflow-api
    sleep 1
    systemctl is-active wiseflow-api
  '
}

do_logs() {
  echo "→ last 40 lines of /var/log/wiseflow-api.log:"
  remote "tail -40 /var/log/wiseflow-api.log"
}

do_restart_mastra() {
  echo "→ restart wiseflow-mastra on $REMOTE_HOST"
  remote 'set -e
    systemctl restart wiseflow-mastra
    sleep 4
    systemctl is-active wiseflow-mastra
  '
}

do_mastra_install() {
  echo "→ npm install in /opt/wiseflow/mastra on $REMOTE_HOST"
  remote 'set -e
    cd /opt/wiseflow/mastra
    /usr/local/bin/npm install --no-fund --no-audit
  '
}

do_mastra_logs() {
  echo "→ last 30 lines of /var/log/wiseflow-mastra.log:"
  remote "tail -30 /var/log/wiseflow-mastra.log"
}

case "${1:-sync}" in
  --no-build|sync-only)
    do_rsync
    ;;
  --logs|logs)
    do_logs
    ;;
  --mastra)
    do_rsync
    do_restart_mastra
    do_mastra_logs
    ;;
  --mastra-install)
    do_rsync
    do_mastra_install
    do_restart_mastra
    do_mastra_logs
    ;;
  --mastra-logs)
    do_mastra_logs
    ;;
  --all)
    do_rsync
    do_build_restart
    do_restart_mastra
    do_logs
    do_mastra_logs
    ;;
  --help|-h|help)
    sed -n '4,28p' "$0"
    ;;
  *)
    do_rsync
    do_build_restart
    do_logs
    ;;
esac
