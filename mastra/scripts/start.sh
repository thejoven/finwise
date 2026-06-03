#!/usr/bin/env bash
#
# 启动 mastra worker, 让它独立于当前 shell 活着.
# 关 terminal / 退 SSH 都不会带死它.
#
# 用法:
#   ./scripts/start.sh         # 启动 (若已跑, no-op)
#   ./scripts/start.sh --stop  # 停
#   ./scripts/start.sh --log   # tail 日志
#   ./scripts/start.sh --status

set -euo pipefail

dir="$(cd "$(dirname "$0")/.." && pwd)"
log_file="${MASTRA_LOG:-/tmp/wiseflow-mastra.log}"
pid_file="${MASTRA_PID:-/tmp/wiseflow-mastra.pid}"

is_running() {
  if [ -f "$pid_file" ]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "$pid"
      return 0
    fi
  fi
  # fallback: 找进程
  pgrep -f "tsx src/index.ts" | head -1
}

cmd_start() {
  local pid
  pid="$(is_running || true)"
  if [ -n "$pid" ]; then
    echo "mastra 已在跑 (PID $pid). 用 --stop 停, --log 看日志."
    return 0
  fi
  if [ ! -f "$dir/.env" ]; then
    echo "缺 $dir/.env. cp .env.example .env 填好再来." >&2
    exit 1
  fi
  cd "$dir"
  # shellcheck disable=SC1091
  set -a; source .env; set +a
  nohup npm start > "$log_file" 2>&1 &
  pid=$!
  disown $pid 2>/dev/null || true
  echo "$pid" > "$pid_file"
  sleep 3
  if kill -0 "$pid" 2>/dev/null; then
    echo "mastra 起来了 PID $pid · log: $log_file"
    echo "等几秒看 health:"
    curl -fsS http://127.0.0.1:9090/healthz && echo
  else
    echo "启动失败, 看 $log_file:" >&2
    tail -20 "$log_file" >&2
    exit 1
  fi
}

cmd_stop() {
  local pid
  pid="$(is_running || true)"
  if [ -z "$pid" ]; then
    echo "mastra 没在跑"
    return 0
  fi
  echo "停 mastra PID $pid..."
  kill "$pid"
  sleep 1
  if kill -0 "$pid" 2>/dev/null; then
    echo "进程还活着, 用 SIGKILL"
    kill -9 "$pid"
  fi
  rm -f "$pid_file"
  echo "停了."
}

cmd_status() {
  local pid
  pid="$(is_running || true)"
  if [ -z "$pid" ]; then
    echo "DOWN"
    exit 1
  fi
  echo "UP · PID $pid"
  ps -o pid,etime,rss,command -p "$pid"
  echo
  curl -fsS http://127.0.0.1:9090/healthz && echo
}

cmd_log() {
  if [ ! -f "$log_file" ]; then
    echo "没有日志: $log_file"
    exit 1
  fi
  tail -f "$log_file"
}

case "${1:-start}" in
  start|"")   cmd_start ;;
  --stop|stop)   cmd_stop ;;
  --status|status) cmd_status ;;
  --log|log)  cmd_log ;;
  *) echo "用法: $0 [start|stop|status|log]"; exit 2 ;;
esac
