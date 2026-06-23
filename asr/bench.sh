#!/usr/bin/env bash
# 临时 benchmark (非常驻服务): 起一个 asr_server 实例, 跑样本音频, 报告 elapsed_ms + 峰值内存.
# CPU 延迟 gate 用. 用法: bash bench.sh [dtype=float32] [threads=0]
set -uo pipefail
cd "$(dirname "$0")"
# shellcheck disable=SC1091
. venv/bin/activate

DTYPE="${1:-float32}"; THREADS="${2:-0}"; PORT=18901
export ASR_DTYPE="$DTYPE" ASR_NUM_THREADS="$THREADS" ASR_PORT="$PORT" ASR_HOST=127.0.0.1

echo ">>> 启动 asr_server (dtype=$DTYPE threads=$THREADS port=$PORT) ..."
python asr_server.py > /tmp/bench-asr.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT

ok=0
for _ in $(seq 1 150); do
  if curl -sf "http://127.0.0.1:$PORT/healthz" 2>/dev/null | grep -q '"model_loaded": *true'; then ok=1; break; fi
  sleep 2
done
[ "$ok" = 1 ] || { echo "!! 模型加载超时:"; tail -25 /tmp/bench-asr.log; exit 1; }

echo ">>> warmup ..."
curl -s -F "audio=@samples/example_zh.wav" "http://127.0.0.1:$PORT/transcribe" >/dev/null 2>&1

echo ">>> 计时 (elapsed_ms 含 ffmpeg 归一化 + 推理):"
for w in example_zh.wav clip5.wav clip15.wav clip30.wav; do
  [ -f "samples/$w" ] || continue
  r=$(curl -s -F "audio=@samples/$w" "http://127.0.0.1:$PORT/transcribe")
  ms=$(printf '%s' "$r" | python -c "import sys,json;print(json.load(sys.stdin).get('elapsed_ms'))" 2>/dev/null || echo "ERR")
  txt=$(printf '%s' "$r" | python -c "import sys,json;print((json.load(sys.stdin).get('text') or '')[:50])" 2>/dev/null || echo "")
  echo "  $w  ->  ${ms}ms   text: $txt"
done

echo ">>> asr_server 进程 RSS:"
ps -o rss= -p "$PID" 2>/dev/null | awk '{printf "  %.1f GB\n", $1/1024/1024}'
echo ">>> done (dtype=$DTYPE threads=$THREADS)"
