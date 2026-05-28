# M2 · 信号管道

> Phase 1 · W3-W4 · 2 周 · 后端 + LLM, 可与 M3 并行

---

## 上下文

M1 把数据底座搭好了, M2 在它上面建第一条业务管道——
**用户输入一条信号 → 立刻入库 → 异步推演 → 推演结果回写**。

这是 Flashfi Engine "AI 在后台工作"的具体实现。

整条管道**不打扰用户**, 但用户可以打开收件箱看到推演已完成的标记。

---

## 前置依赖

- ✅ M1 数据底座完成
- 需要的环境:
  - OpenAI API Key 或 Anthropic API Key
  - 一个能跑 Node.js 的环境(Mastra 在 Node 上跑)

---

## 目标

完成后:

### 后端 API
- `POST /v1/signals` 接受信号 → 写 events 表 → 触发 NATS 消息 → 立即返回 202
- `GET /v1/signals` 返回用户的信号列表(分页, 按时间倒序)
- `GET /v1/signals/:id` 返回单条信号详情(含推演结果)

### LLM 推演
- Mastra 项目骨架 + Analyst Agent + Signal Inference Workflow
- 订阅 NATS `signal.captured`, 跑推演, 通过 Go 内部接口写回结果

### 数据流
```
客户端 POST /v1/signals
    ↓
Go signal handler 写 events 表(signal.captured)
    ↓
NATS publish "signal.captured"
    ↓
Mastra Workflow 消费消息
    ↓
Analyst Agent 跑推演(打标 + 关联资产 + 推演链)
    ↓
Mastra POST /v1/internal/inferences (回写 Go)
    ↓
Go 写 events 表(signal.inference.done)
    ↓
更新物化视图(signals 表的 inference_status 字段)
```

---

## 任务列表

### Task 2.1 · API 接口定义

写 OpenAPI(yaml 或代码注释), 定义:

```
POST /v1/signals
Request:
  {
    "client_event_id": "uuid-v7",
    "raw_text": "今天看到供应商说 HBM 又涨价了",
    "occurred_at": "2026-01-08T10:23:00Z"
  }
Response: 202 Accepted
  {
    "event_id": 123,
    "inference_status": "pending"
  }

GET /v1/signals?limit=20&before=2026-01-08T00:00:00Z
Response:
  {
    "signals": [
      {
        "id": "uuid",
        "raw_text": "...",
        "captured_at": "...",
        "inference_status": "done",
        "inference_summary": "AI 推演摘要(1 句话)",
        "tags": ["HBM", "内存"]
      }
    ],
    "has_more": false
  }
```

### Task 2.2 · Go signal 模块

在 `server/internal/module/signal/` 写:

```
signal/
├── domain.go         # Signal entity
├── handler.go        # HTTP handler
├── repository.go     # DB layer
├── publisher.go      # NATS publisher
└── service.go        # Business logic
```

关键约束:
- handler 写完事件后, **立即返回 202**, 不等推演
- repository 写 events 表 + 更新 signals 物化视图(同一事务)
- publisher 用 NATS JetStream(at-least-once)

**已知坑**:
- 写 events 表和发 NATS 必须在同一事务里, 不然有"写库了消息没发"的丢失。用 outbox pattern。
- 或者更简单: 写 events 表, 然后用 LISTEN/NOTIFY 触发 NATS publisher worker

### Task 2.3 · Mastra 项目初始化

```bash
mkdir mastra && cd mastra
npm init -y
npm i @mastra/core @ai-sdk/anthropic @ai-sdk/openai nats zod
npm i -D typescript @types/node tsx
npx tsc --init
```

目录:
```
mastra/
├── src/
│   ├── agents/
│   │   └── analyst.ts          # Analyst Agent
│   ├── workflows/
│   │   └── signal-inference.ts # 推演 workflow
│   ├── tools/
│   │   └── flashfi-api.ts      # 调 Go 的 /v1/internal/*
│   ├── consumers/
│   │   └── nats.ts             # NATS 消费循环
│   └── index.ts                # 入口
├── package.json
└── tsconfig.json
```

### Task 2.4 · Analyst Agent

写 `mastra/src/agents/analyst.ts`:

```typescript
import { Agent } from '@mastra/core';
import { anthropic } from '@ai-sdk/anthropic';
import { z } from 'zod';

const InferenceSchema = z.object({
  tags: z.array(z.string()).max(5),
  related_assets: z.array(z.object({
    ticker: z.string(),
    rationale: z.string(),
    order: z.enum(['first', 'second', 'third']),
  })).max(6),
  cognitive_layer: z.enum(['first', 'second', 'third']),
  consensus_check: z.enum(['leading', 'aligned', 'lagging']),
  one_line_summary: z.string().max(60),
});

export const analyst = new Agent({
  name: 'analyst',
  instructions: `
你是 Flashfi Engine 的 Analyst。

你的任务是: 拿到一条用户的工作场景信号, 推演它在资本市场上对应的一阶/二阶/三阶受益方。

严格约束:
- 不预测涨跌, 只推演"谁因此变富/变穷"
- 不做估值
- 输出必须是 JSON, 严格符合 schema
- 当信号不够清晰时, 返回空数组(不要瞎编)
- 一阶受益方是常识, 二阶才是 alpha
- 你不是给用户决策, 你是给用户的对照组

输出 schema:
${JSON.stringify(InferenceSchema.shape)}
  `,
  model: anthropic('claude-sonnet-4-5'),
  outputSchema: InferenceSchema,
});
```

**已知坑**:
- 必须用 `outputSchema` 限制输出, 不能让 LLM 自由发挥
- prompt 里的"严格约束"那几条不能省, 都是产品哲学
- Claude Sonnet 4.5 对中文比 GPT-4o 好一些, 推荐用
- 输出有时仍会偏离 schema, 加 retry + validate

### Task 2.5 · Signal Inference Workflow

写 `mastra/src/workflows/signal-inference.ts`:

```typescript
import { Workflow } from '@mastra/core';

export const signalInferenceWorkflow = new Workflow({
  name: 'signal-inference',
  inputSchema: z.object({
    user_id: z.string(),
    event_id: z.number(),
    raw_text: z.string(),
    captured_at: z.string(),
  }),
  steps: [
    {
      id: 'analyze',
      run: async ({ inputs }) => {
        const result = await analyst.generate({
          messages: [{ role: 'user', content: inputs.raw_text }],
        });
        return result.object;
      },
    },
    {
      id: 'persist',
      run: async ({ inputs, steps }) => {
        await flashfiApi.postInference({
          user_id: inputs.user_id,
          source_event_id: inputs.event_id,
          inference: steps.analyze.output,
        });
      },
    },
  ],
});
```

### Task 2.6 · NATS 消费循环

写 `mastra/src/consumers/nats.ts`:

```typescript
import { connect, JSONCodec } from 'nats';

const nc = await connect({ servers: process.env.NATS_URL });
const js = nc.jetstream();
const codec = JSONCodec();

const sub = await js.subscribe('signal.captured', {
  durable: 'mastra-signal-inference',
  manualAck: true,
});

for await (const msg of sub) {
  const data = codec.decode(msg.data);
  try {
    await signalInferenceWorkflow.run({ inputs: data });
    msg.ack();
  } catch (err) {
    console.error('Workflow failed', err);
    msg.nak(); // 重新投递
  }
}
```

**已知坑**:
- `durable` 必须设, 不然消费者 offline 后消息丢失
- `manualAck`, 不要 auto-ack, 否则失败也算成功
- 失败用 `nak()` 不是 `term()`, 让消息重新投递
- 重试 3 次后还失败的, 进 DLQ(死信队列), Phase 1 简化成"打日志报警"

### Task 2.7 · Go 内部接口

在 `server/internal/module/signal/` 加:

```
POST /v1/internal/inferences   (仅内部网络访问, 不暴露公网)
Request:
  {
    "user_id": "...",
    "source_event_id": 123,
    "inference": {
      "tags": [...],
      "related_assets": [...],
      "one_line_summary": "..."
    }
  }
```

Handler 做的事:
1. 写 events 表(signal.inference.done)
2. 更新 signals 物化视图的 `inference_status = 'done'` + `inference_summary`
3. 返回 200

**已知坑**:
- 这个接口必须用 mTLS 或 shared secret 保护, 不能让公网访问
- Mastra 调用时, 把 secret 放 header 里, Go 中间件校验
- Phase 1 可以简化成"绑定到 localhost 127.0.0.1:9090, 不暴露端口"

### Task 2.8 · Manual eval

在 `mastra/tests/manual-eval/` 准备 10 条 fixture 信号(从你工作场景的真实例子里挑):

```
01-hbm-pricing.txt:           今天供应商说 HBM 又涨价了, 第三次了
02-mac-studio-grab.txt:        群里在抢 Mac Studio 512G, 都说带宽吃紧
03-deepseek-deploy.txt:        客户问 DeepSeek 私有化部署
...
```

跑 workflow, 对每个 fixture 的输出**人工评分**:

- Tags 相关吗? 几个?
- Related assets 对吗? 一阶/二阶分对了吗?
- One line summary 抓重点了吗?
- 有没有"瞎编"的现象?

**及格标准**: 10 条里至少 7 条产出符合预期。
不及格 → 改 prompt → 重测。

---

## 验收标准

### 端到端
- [ ] POST 一条信号, 30 秒内 GET 能看到 inference_status = 'done'
- [ ] 推演结果在 Phase 1 范围内合理(tags + assets + summary)
- [ ] 错误信号(乱码、空字符串)优雅处理, 不崩溃

### NATS
- [ ] 消费者 offline 期间消息不丢, 上线后重新消费
- [ ] 消费失败重试 3 次
- [ ] durable + manualAck 配置正确

### LLM 质量
- [ ] 10 条 fixture 至少 7 条产出符合预期
- [ ] 没有"瞎编不存在公司"的现象
- [ ] 输出严格符合 schema

### 内部接口安全
- [ ] /v1/internal/* 只能内部网络访问
- [ ] 无 secret / 错 secret 调用返回 401

### 文档
- [ ] OpenAPI 写完
- [ ] Mastra 项目有 README, 说明环境变量
- [ ] 至少一个 ADR 记录"为什么选 Mastra 而不是 LangChain"

---

## 自由度边界

### 你可以自由决定
- 信号去重策略
- 推演 prompt 的细节优化
- Workflow 步骤拆分
- 内部接口的认证方式(mTLS / shared secret / JWT)

### 必须问
- 想换 LLM 提供商(GPT vs Claude vs Gemini)
- 想引入 RAG / 向量检索(Phase 1 范围外)
- 想加用户级别的 prompt 个性化(Phase 4+)
- 想用 streaming(Phase 1 不需要)

### 不允许
- 让 LLM 自由生成 JSON 不限 schema
- 跳过 manual eval 直接上
- 让 NATS 用 at-most-once
- 把 /v1/internal/* 暴露到公网

---

## 已知坑(汇总)

1. **写 events 表和发 NATS 必须同事务**, 用 outbox pattern 或 LISTEN/NOTIFY。
2. **NATS durable + manualAck**, 否则消息丢失。
3. **LLM outputSchema 必加**, 否则输出不可靠。
4. **/v1/internal 不能暴露公网**, 用 secret 或 mTLS。
5. **Claude Sonnet 4.5 中文表现更好**, 推荐。
6. **Mastra 的 Workflow 失败用 nak() 不是 term()**。
7. **Manual eval 是必须步骤**, 不要跳过。

---

## 交叉引用

- API 契约 → `技术文档/04_API契约规范_大纲.md`
- Mastra Agent 设计 → `技术文档/05_Mastra_Agents与Workflows_大纲.md`
- 信号捕捉产品逻辑 → `产品文档/01_第一层_信号捕捉.md`

---

## 完成后做什么

更新 `phase-1-quiet/00-overview.md` 里 M2 状态为 ✅。
如果 M3 也完成, 进 M4 端到端验证。
