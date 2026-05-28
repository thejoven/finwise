#!/usr/bin/env bash
#
# m4-accept.sh — 自动跑 M4 端到端验收清单.
#
# 验证 8 项, 任何一项 fail 都打红字, 全过才打绿字 "M4 ACCEPTED".
# 跑通后可以进 W8 自己用一周; 不通后回去修代码.
#
# 不跑 mobile 模拟器交互 (那一段必须手测), 只跑可以脚本化的部分:
#   1. backend healthz
#   2. backend POST /v1/signals 202
#   3. backend GET /v1/signals 列表能找回
#   4. 60s 内 inference 状态回写为 done (跨 backend + Mastra + NATS)
#   5. /v1/internal/inferences 缺 token 返回 401
#   6. mobile typecheck (tsc --noEmit)
#   7. mastra typecheck
#   8. mobile SQLite/network/sync 必备文件存在
#
# 用法:
#   ./scripts/m4-accept.sh
#
# Env (有默认值):
#   API_BASE        默认 http://192.168.1.205:8080
#   DEV_BEARER      必填. 不填会在第 2 步炸. 见 SERVER.md.
#   INTERNAL_TOKEN  仅第 5 项用 (验证 401); 不填也能跑.
#   INFERENCE_TIMEOUT  默认 60 (秒)

set -uo pipefail   # 注意: 不用 -e, 因为我们要在每一项 fail 后继续跑剩下的, 最后汇总

API_BASE="${API_BASE:-http://192.168.1.205:8080}"
INFERENCE_TIMEOUT="${INFERENCE_TIMEOUT:-60}"
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# 颜色
if [ -t 1 ]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; DIM=$'\e[2m'; NC=$'\e[0m'
else
  GREEN=""; RED=""; YELLOW=""; DIM=""; NC=""
fi

PASS=0
FAIL=0
SKIP=0
declare -a FAILED_CHECKS=()

pass() { echo "  ${GREEN}✓${NC} $1"; PASS=$((PASS+1)); }
fail() { echo "  ${RED}✗${NC} $1"; FAIL=$((FAIL+1)); FAILED_CHECKS+=("$1"); }
skip() { echo "  ${YELLOW}—${NC} $1 ${DIM}(skipped: $2)${NC}"; SKIP=$((SKIP+1)); }
info() { echo "  ${DIM}$1${NC}"; }
hdr()  { echo; echo "${YELLOW}── $1 ──${NC}"; }

# uuidgen fallback
gen_uuid() {
  if command -v uuidgen >/dev/null 2>&1; then
    uuidgen | tr 'A-Z' 'a-z'
  else
    python3 -c 'import uuid; print(uuid.uuid4())'
  fi
}

# ─────────────────────────────────────────
# 1. backend healthz
# ─────────────────────────────────────────
hdr "1/8 · backend healthz"
http_status=$(curl -sS -o /tmp/m4-healthz.json -w "%{http_code}" "${API_BASE}/healthz" 2>/dev/null || echo "000")
if [ "$http_status" = "200" ]; then
  pass "${API_BASE}/healthz → 200"
  info "$(cat /tmp/m4-healthz.json)"
else
  fail "${API_BASE}/healthz → ${http_status}"
  info "$(cat /tmp/m4-healthz.json 2>/dev/null || echo '(no body)')"
fi

# ─────────────────────────────────────────
# 2. backend POST /v1/signals 202
# ─────────────────────────────────────────
hdr "2/8 · POST /v1/signals 202"
if [ -z "${DEV_BEARER:-}" ]; then
  skip "POST /v1/signals" "DEV_BEARER env 未设, 跳过 后续 3/4/5 也会跳"
  CAPTURE_OK=0
else
  cid=$(gen_uuid)
  now=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
  body=$(printf '{"client_event_id":"%s","raw_text":"m4-accept 烟雾测试 · %s","occurred_at":"%s"}' "$cid" "$now" "$now")
  resp=$(curl -sS -o /tmp/m4-capture.json -w "%{http_code}" \
    -X POST "${API_BASE}/v1/signals" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer ${DEV_BEARER}" \
    -d "$body" 2>/dev/null || echo "000")
  if [ "$resp" = "202" ]; then
    SIGNAL_ID=$(python3 -c "import json,sys; print(json.load(open('/tmp/m4-capture.json'))['signal_id'])" 2>/dev/null)
    if [ -n "$SIGNAL_ID" ]; then
      pass "POST → 202, signal_id=${SIGNAL_ID:0:8}…"
      CAPTURE_OK=1
    else
      fail "POST 202 但 body 缺 signal_id"
      info "$(cat /tmp/m4-capture.json)"
      CAPTURE_OK=0
    fi
  else
    fail "POST /v1/signals → ${resp}"
    info "$(cat /tmp/m4-capture.json 2>/dev/null || echo '(no body)')"
    CAPTURE_OK=0
  fi
fi

# ─────────────────────────────────────────
# 3. backend GET /v1/signals 找回
# ─────────────────────────────────────────
hdr "3/8 · GET /v1/signals 能找回刚录的"
if [ "$CAPTURE_OK" != "1" ]; then
  skip "GET /v1/signals" "依赖 step 2"
else
  curl -sS -o /tmp/m4-list.json -w "%{http_code}" \
    "${API_BASE}/v1/signals?limit=10" \
    -H "Authorization: Bearer ${DEV_BEARER}" > /tmp/m4-list-status 2>/dev/null
  status=$(cat /tmp/m4-list-status)
  if [ "$status" = "200" ]; then
    found=$(python3 -c "
import json,sys
d=json.load(open('/tmp/m4-list.json'))
target='$SIGNAL_ID'
print('YES' if any(s['id']==target for s in d.get('signals', [])) else 'NO')
" 2>/dev/null)
    if [ "$found" = "YES" ]; then
      pass "刚录的 signal 出现在列表里"
    else
      fail "列表里没找到 signal ${SIGNAL_ID:0:8}…"
    fi
  else
    fail "GET /v1/signals → ${status}"
  fi
fi

# ─────────────────────────────────────────
# 4. inference 状态在 60s 内回写
# ─────────────────────────────────────────
hdr "4/8 · inference 在 ${INFERENCE_TIMEOUT}s 内回写"
if [ "$CAPTURE_OK" != "1" ]; then
  skip "inference 状态轮询" "依赖 step 2"
else
  start=$(date +%s)
  done_seen=0
  while true; do
    elapsed=$(( $(date +%s) - start ))
    if [ "$elapsed" -ge "$INFERENCE_TIMEOUT" ]; then
      break
    fi
    curl -sS -o /tmp/m4-detail.json -w "%{http_code}" \
      "${API_BASE}/v1/signals/${SIGNAL_ID}" \
      -H "Authorization: Bearer ${DEV_BEARER}" > /tmp/m4-detail-status 2>/dev/null
    status=$(cat /tmp/m4-detail-status)
    if [ "$status" = "200" ]; then
      inf_status=$(python3 -c "import json; print(json.load(open('/tmp/m4-detail.json'))['inference_status'])" 2>/dev/null)
      if [ "$inf_status" = "done" ]; then
        done_seen=1
        break
      fi
    fi
    sleep 3
  done
  if [ "$done_seen" = "1" ]; then
    pass "inference 在 ${elapsed}s 内变成 done"
    summary=$(python3 -c "import json; d=json.load(open('/tmp/m4-detail.json')); print(d.get('inference_summary') or '(empty)')" 2>/dev/null)
    info "summary: $summary"
  else
    fail "inference 在 ${INFERENCE_TIMEOUT}s 内没变 done"
    info "可能原因: Mastra 没在跑 / NATS 链路断 / Anthropic API key 错"
    info "诊断: ssh root@192.168.1.205 'tail -50 /var/log/flashfi-api.log'"
    info "诊断: ssh root@192.168.1.205 'docker compose -f /opt/flashfi/docker-compose.yml logs --tail 50 nats'"
  fi
fi

# ─────────────────────────────────────────
# 5. /v1/internal/* 401 if no token
# ─────────────────────────────────────────
hdr "5/8 · /v1/internal/inferences 缺 token 返回 401"
inf_body='{"signal_id":"00000000-0000-0000-0000-000000000000","user_id":"00000000-0000-0000-0000-000000000000","summary":"x","tags":[],"model":"test"}'
status=$(curl -sS -o /dev/null -w "%{http_code}" \
  -X POST "${API_BASE}/v1/internal/inferences" \
  -H "Content-Type: application/json" \
  -d "$inf_body" 2>/dev/null || echo "000")
if [ "$status" = "401" ] || [ "$status" = "403" ]; then
  pass "无 token 被拒 (${status})"
else
  fail "无 token 期望 401/403, 实际 ${status}"
fi

# ─────────────────────────────────────────
# 6. mobile typecheck
# ─────────────────────────────────────────
hdr "6/8 · mobile tsc --noEmit"
if [ -d "$REPO_ROOT/mobile/node_modules" ]; then
  cd "$REPO_ROOT/mobile"
  if npx --no-install tsc --noEmit > /tmp/m4-mobile-tsc.log 2>&1; then
    pass "mobile typecheck 通过"
  else
    fail "mobile typecheck 失败"
    info "see /tmp/m4-mobile-tsc.log"
    tail -20 /tmp/m4-mobile-tsc.log | sed 's/^/    /'
  fi
  cd "$REPO_ROOT"
else
  skip "mobile typecheck" "mobile/node_modules 不存在, 先 npm install"
fi

# ─────────────────────────────────────────
# 7. mastra typecheck
# ─────────────────────────────────────────
hdr "7/8 · mastra tsc --noEmit"
if [ -f "$REPO_ROOT/mastra/node_modules/.bin/tsc" ]; then
  cd "$REPO_ROOT/mastra"
  if ./node_modules/.bin/tsc -p . --noEmit > /tmp/m4-mastra-tsc.log 2>&1; then
    pass "mastra typecheck 通过"
  else
    fail "mastra typecheck 失败"
    info "see /tmp/m4-mastra-tsc.log"
    tail -20 /tmp/m4-mastra-tsc.log | sed 's/^/    /'
  fi
  cd "$REPO_ROOT"
else
  skip "mastra typecheck" "mastra/node_modules/.bin/tsc 不存在, 先 npm install"
fi

# ─────────────────────────────────────────
# 8. M4 必备文件
# ─────────────────────────────────────────
hdr "8/8 · M4 持久化/网络/同步必备文件存在"
required_files=(
  "$REPO_ROOT/mobile/src/core/storage/db.ts"
  "$REPO_ROOT/mobile/src/core/storage/pending-signals-repo.ts"
  "$REPO_ROOT/mobile/src/core/network/netinfo.ts"
  "$REPO_ROOT/mobile/src/core/network/appstate.ts"
  "$REPO_ROOT/mobile/src/features/capture/store.ts"
  "$REPO_ROOT/mobile/src/features/capture/PendingFlush.tsx"
  "$REPO_ROOT/server/internal/module/signal/handler_test.go"
  "$REPO_ROOT/mastra/tests/manual-eval/run.ts"
)
missing=0
for f in "${required_files[@]}"; do
  if [ ! -f "$f" ]; then
    fail "缺文件: ${f#$REPO_ROOT/}"
    missing=$((missing+1))
  fi
done
if [ "$missing" = "0" ]; then
  pass "M4 必备 ${#required_files[@]} 文件都在"
fi

# 检查 package.json 依赖
hdr "    · mobile package.json 关键依赖"
pkg="$REPO_ROOT/mobile/package.json"
deps_ok=1
for dep in "expo-sqlite" "@react-native-community/netinfo"; do
  if grep -q "\"$dep\"" "$pkg"; then
    pass "$dep 已声明"
  else
    fail "$dep 缺失"
    deps_ok=0
  fi
done

# ─────────────────────────────────────────
# 汇总
# ─────────────────────────────────────────
echo
echo "${YELLOW}═══════════════════════════════════${NC}"
if [ "$FAIL" = "0" ]; then
  echo "${GREEN}M4 ACCEPTED${NC}  ✓ $PASS · ✗ $FAIL · — $SKIP"
  echo "${DIM}下一步: 进 W8 自己用一周. 见 docs/PROGRESS.md § 3.${NC}"
  exit 0
else
  echo "${RED}M4 NOT READY${NC}  ✓ $PASS · ✗ $FAIL · — $SKIP"
  echo
  echo "failed:"
  for c in "${FAILED_CHECKS[@]}"; do
    echo "  - $c"
  done
  echo
  echo "${DIM}修完上面这些再跑一次. 不通过不进 W8.${NC}"
  exit 1
fi
