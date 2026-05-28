# mastra/

Flashfi Engine 的 LLM 编排. Node + Mastra + OpenAI-compatible SDK (默认接 DeepSeek) + NATS JetStream.

```
src/
├── agents/
│   ├── analyst.ts          # M2 推演 (一/二/三阶链)
│   ├── socratic.ts         # M5 五轮追问出题 + Diagnosis sub-agent
│   ├── narrator.ts         # M7 承诺书 (verbatim 校验)
│   ├── consensus.ts        # M6 G2 反共识打分
│   ├── editor.ts           # M9 焦虑日陪伴文字
│   ├── diagnostician.ts    # M11 复盘 focus 维度
│   └── schema.ts           # NATS 消息 schema
├── llm/
│   └── model.ts            # provider-neutral 模型工厂 (默认 DeepSeek)
├── workflows/
│   ├── signal-inference.ts    # M2 analyze → persist
│   ├── refinement-step.ts     # M5 出下一题
│   └── commitment-draft.ts    # M7 起草承诺书
├── tools/
│   └── flashfi-api.ts        # POST /v1/internal/*
├── consumers/
│   └── nats.ts               # signal / refinement / gate.passed 三个 durable consumer
├── server/
│   └── http.ts               # Go 同步调 Mastra 的 HTTP server (M6/M9/M11)
├── config/
│   └── env.ts                # 全部 env 入口
└── index.ts                  # worker 进程 (NATS consumer + HTTP server)

tests/
├── manual-eval/            # M2 Analyst eval (≥7/10 pass)
└── eval/
    ├── consensus/          # M6 G2 (≥7/10)
    ├── editor/             # M9 (≥4/6)
    └── diagnostician/      # M11 (≥4/6)
```

## 环境

- Node 20 LTS
- `LLM_API_KEY` (DeepSeek 默认) + `LLM_BASE_URL` (默认 `https://api.deepseek.com`)
- 同一台机器跑 Postgres + NATS (Go server 那边的 `make dev`)

## 启动

```bash
cd mastra
cp .env.example .env
# 编辑 .env, 填:
#   - LLM_API_KEY (DeepSeek key, 控制台拿: https://platform.deepseek.com/api_keys)
#   - INTERNAL_TOKEN (与 server .env 一致)
npm install
npm run dev               # tsx watch · 同时跑 NATS consumer + HTTP server (127.0.0.1:9090)
```

## 切换 LLM 提供商

不改代码, 改 env:

| Provider | LLM_BASE_URL | ANALYST_MODEL 推荐 |
|---|---|---|
| DeepSeek (默认) | `https://api.deepseek.com` | `deepseek-chat` (V3) or `deepseek-reasoner` (R1) |
| OpenAI 官方 | `https://api.openai.com` (省略 = 默认) | `gpt-4o-mini` / `gpt-4o` |
| Anthropic via OpenRouter | `https://openrouter.ai/api` | `anthropic/claude-sonnet-4.5` |
| 本地 vLLM / Ollama | `http://localhost:11434/v1` 之类 | depends on model loaded |

代码统一通过 `src/llm/model.ts` 的 `defaultModel` 注入到每个 agent.

## 验证

```bash
# 1) Go server 起来, postgres + nats 起来
# 2) Mastra worker 起来 (上面 npm run dev)
# 3) POST 一条信号 (server 那边)
curl -X POST http://192.168.1.205:8080/v1/signals \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $DEV_BEARER" \
  -d '{"client_event_id":"'$(uuidgen)'","raw_text":"今天供应商说 HBM 又涨价了","occurred_at":"'$(date -u +%FT%TZ)'"}'

# 4) 等 ~30 秒, 看 mastra 日志有 "inference done"
# 5) GET 看 inference_status 变 done
curl -H "Authorization: Bearer $DEV_BEARER" http://192.168.1.205:8080/v1/signals
```

## Eval (跑前必须 LLM_API_KEY 设好)

```bash
npm run eval               # M2 Analyst (10 fixtures, ≥7/10)
npm run eval:consensus     # M6 G2 (10 fixtures, ≥7/10)
npm run eval:editor        # M9 (6 fixtures, ≥4/6, verbatim 校验)
npm run eval:diagnostician # M11 (6 fixtures, ≥4/6, focus_dim match)
npm run eval:all           # 全跑一遍
```

每个 runner 写 `tests/eval/<agent>/eval-output/summary.json`, 包含每条 fixture 的检查结果.

## 设计决策

- ADR: 见 [docs/adr/0003-mastra-over-langchain.md](../docs/adr/0003-mastra-over-langchain.md)
- ADR: DeepSeek 通过 OpenAI-compat 接, 不深度绑定 provider — 见 `src/llm/model.ts` 注释

## 关键约束

- `consumers/nats.ts` 三个 durable consumer (signal.captured / refinement.* / gate.passed) 必须 `manualAck + ackExplicit` — offline 期间不丢消息
- agents 用 zod schema 强约束输出, 不让 LLM 自由发挥
- Narrator 必须 verbatim 引用用户原 reasons — workflow 层做 substring 校验, 失败 nak
- 失败重试 3 次后进 DLQ (Phase 1-3 = log only, 不阻塞队列)
- Mastra HTTP 服务用同一个 INTERNAL_TOKEN 跟 Go server 互认
