#!/usr/bin/env bash
#
# deploy.sh — build the admin bundle, ship it to 192.168.1.205, install/refresh
# the nginx vhost.
#
# Usage:
#   ./deploy/deploy.sh            # build + rsync + (re)load nginx
#   ./deploy/deploy.sh --no-build # rsync only (you already ran `npm run build`)
#   ./deploy/deploy.sh --nginx    # only sync the nginx site + reload
#
# Env overrides:
#   REMOTE_HOST    (default: root@192.168.1.205)
#   REMOTE_DIR     (default: /opt/wiseflow/web-admin)
#   SSH_KEY        (default: $HOME/.ssh/id_ed25519_clh_520jwenlee)
#   ADMIN_PORT     (default: 8082)

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@192.168.1.205}"
REMOTE_DIR="${REMOTE_DIR:-/opt/wiseflow/web-admin}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_clh_520jwenlee}"
ADMIN_PORT="${ADMIN_PORT:-8082}"

here="$(cd "$(dirname "$0")/.." && pwd)"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new"

remote() {
  # shellcheck disable=SC2086
  ssh $SSH_OPTS "$REMOTE_HOST" "$@"
}

mode="full"
case "${1:-}" in
  --no-build) mode="rsync-only" ;;
  --nginx)    mode="nginx-only" ;;
  --help|-h)
    sed -n '4,18p' "$0"; exit 0 ;;
esac

do_build() {
  echo "→ npm run build"
  ( cd "$here" && npm run build )
}

do_sync() {
  echo "→ ensure $REMOTE_DIR/dist exists"
  remote "mkdir -p $REMOTE_DIR/dist"

  echo "→ rsync dist/ to $REMOTE_HOST:$REMOTE_DIR/dist/"
  rsync -avz --delete \
    -e "ssh $SSH_OPTS" \
    "$here/dist/" "$REMOTE_HOST:$REMOTE_DIR/dist/"
}

do_nginx() {
  local conf="$here/deploy/wiseflow-admin.nginx.conf"
  echo "→ install nginx site wiseflow-admin (port $ADMIN_PORT)"
  # Allow overriding the listen port at deploy time.
  sed "s/listen 8082;/listen ${ADMIN_PORT};/; s/listen \[::\]:8082;/listen [::]:${ADMIN_PORT};/" \
    "$conf" > /tmp/wiseflow-admin.nginx.conf
  scp $SSH_OPTS /tmp/wiseflow-admin.nginx.conf "$REMOTE_HOST:/etc/nginx/sites-available/wiseflow-admin" >/dev/null
  rm -f /tmp/wiseflow-admin.nginx.conf
  remote '
    set -e
    ln -sf /etc/nginx/sites-available/wiseflow-admin /etc/nginx/sites-enabled/wiseflow-admin
    nginx -t
    systemctl reload nginx
  '
}

case "$mode" in
  full)
    do_build
    do_sync
    do_nginx
    ;;
  rsync-only)
    do_sync
    ;;
  nginx-only)
    do_nginx
    ;;
esac

echo
echo "✓ done. admin → http://192.168.1.205:${ADMIN_PORT}/"
