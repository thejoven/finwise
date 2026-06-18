#!/usr/bin/env bash
#
# grant-admin.sh — 在部署服务器 (192.168.1.205) 上把某邮箱设为/取消管理员.
#
# 背后跑 server/cmd/admin (复用 account.Service: 正确 bcrypt + 邮箱校验), 通过
# /opt/alphax/.env 里的 DATABASE_URL 连 docker compose 的 Postgres.
#
# 前置: 先 ./scripts/remote-sync.sh 把代码 (含 cmd/admin) 推上去, 并跑过 017 迁移.
#
# 用法:
#   ./scripts/grant-admin.sh jwen@vip.qq.com 'S0meStr0ngPw'   # 创建(若无)+授予管理员
#   ./scripts/grant-admin.sh jwen@vip.qq.com                  # 仅提权 (用户已存在)
#   ./scripts/grant-admin.sh someone@example.com --revoke     # 取消管理员
#
# Env 覆盖:
#   REMOTE_HOST  (默认 root@192.168.1.205)
#   REMOTE_DIR   (默认 /opt/alphax)
#   SSH_KEY      (默认 $HOME/.ssh/id_ed25519_clh_520jwenlee)

set -euo pipefail

REMOTE_HOST="${REMOTE_HOST:-root@192.168.1.205}"
REMOTE_DIR="${REMOTE_DIR:-/opt/alphax}"
SSH_KEY="${SSH_KEY:-$HOME/.ssh/id_ed25519_clh_520jwenlee}"
SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=accept-new"

EMAIL="${1:-}"
ARG2="${2:-}"

if [ -z "$EMAIL" ]; then
  echo "用法: $0 <email> [password|--revoke]" >&2
  exit 2
fi

# 组装 CLI flags.
CLI_ARGS="-email $EMAIL"
if [ "$ARG2" = "--revoke" ]; then
  CLI_ARGS="$CLI_ARGS -revoke"
elif [ -n "$ARG2" ]; then
  CLI_ARGS="$CLI_ARGS -password $ARG2"
fi

echo "→ 在 $REMOTE_HOST 上运行 admin CLI ($EMAIL)"
# shellcheck disable=SC2086
ssh $SSH_OPTS "$REMOTE_HOST" "
  set -euo pipefail
  set -a; . $REMOTE_DIR/.env; set +a
  cd $REMOTE_DIR/server
  /usr/local/go/bin/go run ./cmd/admin $CLI_ARGS
"
