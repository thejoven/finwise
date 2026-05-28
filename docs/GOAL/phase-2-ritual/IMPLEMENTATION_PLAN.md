# Phase 2 · 仪式 · Implementation Plan

> W9-W18 · 10 周 · M5 五轮追问 → M6 四道门 → M7 承诺书 → M8 签字流程
>
> 这份文档是 Phase 2 的"施工图", 不是任务说明。任务说明在各模块的 `Mn-*.md`。
>
> **读这份文档前, 必须先读完**:
> - `docs/GOAL/AGENT_BRIEF.md` § 2 (硬约束) + § 9 (常见错误)
> - `docs/GOAL/phase-2-ritual/00-overview.md`
> - 当前要实施的那个 Mn 模块说明
>
> **这份文档的覆盖范围**: 数据模型 · 后端模块 · Mastra Agents · Mobile UI · 关键 ADR · 顺序与时间 · Phase 1 衔接 · 反模式自查。
>
> **这份文档不覆盖**: 具体函数命名、文件内部结构、单测形态——那些是 § 3 自由度范围内的实现细节。

---

## § 1 · Phase 2 一句话

**18 周末, 我能在 iPhone 上独自走完一次"看到信号 → 被追问 → 通过四道门 → 阅读承诺书 → 签下名"的完整仪式; 而且至少有 3 次, 系统在四道门把我的信号悄悄归档, 我事后才发现, 不感觉被冒犯。**

更细一点的用户故事:

> 周三上午, 我打开 APP。收件箱顶部多了一张和平时不一样的卡:
> *"我从你最近 14 天的几条信号里看到一条可能值得下注的事, 要不要展开聊聊。"*
>
> 我点开。进入五轮追问。第一轮卡片像一封信:**"你说 1 月 8 日 群里在抢 HBM 现货价。在你看来, 谁会因为这件事被迫做出让步?"** 给我 4 个选项, 其中 1 个是干扰项, 1 个是漏选检测。我选, 提交, 下一封信。
>
> 五轮答完(大约 4 分钟), 系统在后台跑四道门。我什么都看不到——系统在思考。大约 6 秒后, 页面换了:
>
> **承诺书第 I 份 · 草稿**
> SK 海力士 · 5% 仓位 · 6 个月
> 退出条件三条(罗马数字)
> "你 6 个月后会感谢自己的理由"三段, 每段都引用了我之前自己说过的话
>
> 我滚动到底, 按下黑底白字的"签字, 提交承诺"按钮。按下瞬间 mediumImpact 触感。0.4 秒后, 整页换成"持仓中 · 第 0 天"。没有 toast, 没有"提交成功!", 没有"恭喜你完成第 1 份承诺"。
>
> 关掉 APP。

**注意**: Phase 2 不实现持仓陪伴、不实现退出条件触发、不实现复盘。"持仓中"页只是状态机的一个静态展示页, 真正的陪伴在 Phase 3 的 M9-M11。

---

## § 2 · 数据模型新增

### 2.1 events 表新增 type 及 payload schema

下面 5 个 EventType **已经**在 `server/internal/domain/event.go` 里声明 (Phase 1 末期占位声明)。本 Phase 落地的是它们的 **payload schema + 真实写入路径**。

| EventType | 写入时机 | NATS subject | 触发模块 |
|---|---|---|---|
| `refinement.started` | 系统选中一条信号开始追问 | `refinement.started` | M5 |
| `refinement.answered` | 用户答完一轮(每轮 1 条) | `refinement.answered` | M5 |
| `gate.evaluated` | 四道门评估跑完(无论过/不过) | `gate.evaluated` | M6 |
| `commitment.drafted` | Narrator 生成承诺书草稿 | `commitment.drafted` | M7 |
| `commitment.signed` | 用户按下签字按钮成功 | `commitment.signed` | M8 |

外加 Phase 2 引入的几个**辅助事件**(不在 event.go 占位列表里, 需要补声明):

| EventType | 写入时机 | NATS subject | 触发模块 |
|---|---|---|---|
| `refinement.completed` | 五轮答完或提前结束 | `refinement.completed` | M5 |
| `gate.archived` | 某条信号因门 N 失败被沉默归档 | `gate.archived` | M6 |
| `commitment.postponed` | 用户在签字页选"先放着" | `commitment.postponed` | M8 |
| `commitment.abandoned` | 连续 postpone ≥ 3 自动归档 | `commitment.abandoned` | M8 |

**payload 结构(伪代码层, 不写 Go struct)**

```
RefinementStartedPayload {
  refinement_id: uuid          // 一次完整 5 轮的 session id
  user_id:       uuid
  signal_ids:    [uuid]        // 触发本次追问的所有信号(可能 ≥ 1)
  primary_asset: string?       // 推演认定的主要相关资产 ticker
  started_at:    timestamp
}

RefinementAnsweredPayload {
  refinement_id: uuid
  round:         int (1..5)
  question_id:   string         // Socratic Agent 返回的题目稳定 id
  question_kind: enum(single, multi, ordering, open)
  question_text: string         // 题目正文(归档用)
  options:       [{id, text, is_distractor, is_required}]  // 题型为非 open 时
  user_answer:   {choice_ids: [string], open_text: string?, time_ms: int}
  diagnosis:     {kind: enum(correct, partial_miss, distractor, weak),
                  note:  string?}            // 不是"标准答案", 是诊断
  answered_at:   timestamp
}

RefinementCompletedPayload {
  refinement_id: uuid
  rounds_done:   int (1..5)
  ended_early:   bool             // 第 3 题已明确不需要继续
  decision:      enum(eligible_for_gate, training_only)
  ended_at:      timestamp
}

GateEvaluatedPayload {
  evaluation_id: uuid
  refinement_id: uuid
  gates: {
    g1_thickness:    {pass: bool, count: int,  detail: string?}
    g2_anti_consensus:{pass: bool, score: 0..100, detail: string?}
    g3_window:       {pass: bool, months: number, detail: string?}
    g4_edge:         {pass: bool, sub:  {explain, direct, track_record, exit_known}}
  }
  failed_gate:   int? (1..4)       // null 表示四门全过
  archived_pool: enum(observation, lesson, calendar, discard) | null
  evaluated_at:  timestamp
}

CommitmentDraftedPayload {
  commitment_id:    uuid
  evaluation_id:    uuid
  thesis: {
    asset_ticker:        string
    asset_name:          string
    action:              enum(buy, sell, hold)
    position_pct:        number (0..100)
    duration_months:     int (1..36)
    entry_method:        string         // 自由描述, 100 字内
    exit_conditions:     [string] (2..4)
    reasons_for_future_self: [string] (3..5)   // 必须真实引用历史 signal 原话
  }
  drafted_at:       timestamp
  model:            string
}

CommitmentSignedPayload {
  commitment_id:    uuid
  signed_at:        timestamp
  signing_client_id: string        // 防双击的客户端幂等 key, 见 § 3.4
}

CommitmentPostponedPayload {
  commitment_id:    uuid
  count:            int (1..3)
  reason:           string?       // 可选, 让用户写一两句"为什么先放着"
  postponed_at:     timestamp
}

CommitmentAbandonedPayload {
  commitment_id:    uuid
  reason_kind:      enum(postpone_threshold, manual)
  abandoned_at:     timestamp
}

GateArchivedPayload {
  evaluation_id:    uuid
  pool:             enum(observation, lesson, calendar, discard)
  failed_gate:      int (1..4)
  human_reason:     string        // 产品语言, 不是技术语言. 例: "目前只看到 2 条独立信号"
  archived_at:      timestamp
}
```

**关键约束**:
- 所有 payload 字段都用 snake_case (与 Phase 1 一致, JSONB 列), Go 端用 json tag。
- `payload` 内**不复制 user_id**——它已经在 events.user_id 列, 重复存只会拉新的不一致。例外: 当 Mastra 端要消费时, NATS message 里 user_id 是冗余的(为了消费者不必 join events 表), 但 events.payload 里不带。
- 时间戳用 RFC3339, UTC, 客户端时钟和服务端时钟分别在 `occurred_at` 和 `recorded_at` 体现, **不**混用。
- `causation_id` 一定要填:
  - `refinement.answered.causation_id` → 上一轮 `refinement.answered.id`(或第一轮的 `refinement.started.id`)
  - `gate.evaluated.causation_id` → 对应的 `refinement.completed.id`
  - `commitment.drafted.causation_id` → 对应的 `gate.evaluated.id`(且 gate.failed_gate is null)
  - `commitment.signed.causation_id` → `commitment.drafted.id`

### 2.2 物化视图新增

四张:

1. **`refinement_sessions`** — 一次完整 5 轮对话的 head
   - 列: id (uuid), user_id, primary_signal_id, status (`active|completed|abandoned`), rounds_done, started_at, completed_at, updated_at
   - 写入路径: refinement.started → INSERT; refinement.answered → UPDATE rounds_done; refinement.completed → status / completed_at
   - 索引: (user_id, status), (user_id, started_at DESC)
   - **不存追问明细** — 明细在 events 表里, 视图只是 head, 让 list/get 快

2. **`gate_evaluations`** — 一次四道门评估的快照
   - 列: id (uuid), user_id, refinement_id, failed_gate (int?), archived_pool (enum?), passed (bool), evaluated_at
   - 还把四道门的判据明细以 JSONB 存 (`gates_detail jsonb`), 这样 archive 列表展示"门 N 失败的原因"不必反序列化 events.payload
   - 索引: (user_id, archived_pool), (user_id, evaluated_at DESC), (user_id, passed) where passed = true

3. **`commitments`** — 承诺书(草稿和已签)
   - 列: id (uuid), user_id, evaluation_id, status (`drafted|signed|postponed|abandoned`), thesis JSONB, pdf_path text?, signed_at?, postpone_count int default 0, drafted_at, updated_at
   - 唯一约束: (user_id, evaluation_id) — 同一次评估只能产生一份承诺书
   - 索引: (user_id, status), (user_id, signed_at DESC) where signed_at is not null
   - **status 为 signed 之后不可逆**: 用 trigger 保护(或者应用层 + 测试守门)。事件溯源原则: 真实的真相在 events 里, 视图是 cache, 但展示给用户的状态要稳。

4. **`holdings`** — 已签字承诺的"持仓状态"
   - 列: id (uuid, = commitment_id), user_id, status (`active|triggered|closed|expired|archived`), signed_at, exit_conditions jsonb (从承诺书复制), exit_check_state jsonb (每个退出条件的进度计数, Phase 2 留 `{}` 空对象, Phase 3 填), updated_at
   - 索引: (user_id, status)
   - **关系**: holdings.id = commitments.id (1:1), 不同表是因为生命周期不同——commitments 是文书, holdings 是状态机。

### 2.3 Migration 文件

按 Phase 1 命名习惯, 增 3 个 migration:

- **`003_create_refinement.up.sql` / `.down.sql`**
  - `refinement_sessions` 表 + 索引
  - **不**加 REVOKE(这是视图, 不是 events; 视图可写)

- **`004_create_gates_commitments.up.sql` / `.down.sql`**
  - `gate_evaluations` 表 + 索引
  - `commitments` 表 + 索引 + signed_at 不可回退的 trigger
  - 顺序: gate_evaluations 必须先于 commitments(后者 FK 引前者)

- **`005_create_holdings.up.sql` / `.down.sql`**
  - `holdings` 表 + 索引
  - FK 到 commitments.id

**为什么 3 个不是 1 个**: 每个 migration 对应一个独立模块。如果 M5 上线了 refinement_sessions 但 M6 还没动, 我们仍然能 `migrate up` 到 003 用。Phase 1 的 002 把 signals + outbox 放一起是因为它们物理上同时上线, Phase 2 不是。

### 2.4 索引策略

**写多读多的视图(refinement_sessions, gate_evaluations)**:
- 主索引: (user_id, 时间倒序) — list 默认排序
- 状态索引: (user_id, status) — 档案 tab 按池分组用

**承诺书 commitments**:
- (user_id, status) — 列表过滤
- partial index on signed_at DESC where signed_at is not null — 已签字承诺按时间倒排, 只有一小部分 row 进索引
- **不**给 thesis JSONB 加 GIN 索引——Phase 2 没有按 thesis 内部字段查询的需求。Phase 3 + 复盘时可能加, 那时再加, 不预先。

**holdings**:
- (user_id, status) — 主要查询: "我当前所有 active 持仓"

**outbox 复用 Phase 1 已有的 `idx_outbox_pending`**——不需要新索引。

### 2.5 一个容易踩的坑: 不要造 `refinements` 表

最初想造一张 `refinements(id, signal_id, round_data jsonb)` 把每轮答题塞 jsonb 里。**不要**——这违反事件溯源, 每答一轮 UPDATE 一次 jsonb 会让"第 3 轮的答案"成了可变状态。

正确做法: `refinement_sessions` 只存 head(状态、进度), 明细的所有轮次答题在 events.refinement.answered 里, 按 refinement_id 索引。重建一次完整 5 轮回放就是按 events 查询。

---

## § 3 · Go 后端新模块

整体仿 Phase 1 `server/internal/module/signal/` 的三层结构:

```
server/internal/module/<name>/
├── handler.go     // gin 路由 + DTO + auth 取 userID
├── service.go     // 业务规则 + Validate + ErrInvalidInput
└── repository.go  // SQL + 事务 + outbox 写入
```

**模块依赖**: signal → refinement → gate → commitment → signing(handler 层用 commitment 模块的 service)。

### 3.1 M5 · refinement 模块

#### HTTP 路由

| Method | Path | Auth Group | 说明 |
|---|---|---|---|
| POST | `/v1/refinement/sessions` | publicV1 | 新建一次 5 轮 session(idempotent on client_event_id) |
| GET | `/v1/refinement/sessions/:id` | publicV1 | 拉取 session head + 已完成的轮次 |
| GET | `/v1/refinement/sessions/:id/stream` | publicV1 | **SSE 流**: 等待"下一轮题目"事件 |
| POST | `/v1/refinement/sessions/:id/answer` | publicV1 | 提交某一轮答题(round + answer body) |
| POST | `/v1/internal/refinement/sessions/:id/question` | internalV1 | Mastra 推回某一轮题目正文 |

**为什么 stream 是 GET 而不是 POST**: SSE 在 RN 上要用 `react-native-fetch-api`(或 `fetch-event-source` polyfill), 走 GET 更通用; 而且 SSE 不接收 body, 适合 GET。

#### Service 层职责

`refinement.Service`:

- `Start(ctx, cmd StartCommand) (*Session, error)` — 创建 session, 写 refinement.started event + outbox。Validate: signal_ids 非空、所有 signal 都属于该用户。
- `RecordAnswer(ctx, cmd AnswerCommand) (*AnswerResult, error)` — 写 refinement.answered event。校验 round 是顺序递增 (current_round + 1)。决定本轮是不是最后一轮: 如果 round = 5 或者 ended_early 信号触发, 同事务里再写 refinement.completed。
- `Get(ctx, userID, sessionID) (*SessionView, error)` — 视图 + 所有轮次明细(按 round 顺序)
- `StreamNextQuestion(ctx, sessionID, w writer) error` — SSE 实现: 订阅一个 NATS 内部 subject `refinement.question.<session_id>`, 把 Mastra 推回的题目 raw bytes 直写到 SSE response。带 30 秒 keepalive heartbeat。

#### Repository 方法

- `InsertSessionAndEvent(ctx, payload) (*Session, eventID, error)` — 事务: events insert + refinement_sessions insert + outbox insert
- `InsertAnswerEvent(ctx, sessionID, payload) (eventID, error)` — 事务: events insert + refinement_sessions update (rounds_done +=1, updated_at) + outbox insert
- `MarkCompleted(ctx, sessionID, decision, endedEarly) error` — 事务: events insert (refinement.completed) + sessions update (status, completed_at)
- `Get(ctx, userID, sessionID) (*Session, []Round, error)` — Get head + 关联的 refinement.answered events 解析为 []Round (按 events.id 排序)

#### NATS 主题(发布/订阅)

| Subject | 方向 | 谁写 / 谁读 |
|---|---|---|
| `refinement.started` | publish | Go server outbox → Mastra consumer 拉第 1 轮题目 |
| `refinement.answered` | publish | Go server outbox → Mastra consumer 拉下一轮 |
| `refinement.completed` | publish | Go server outbox → 触发 M6 gate evaluation |
| `refinement.question.<session_id>` | publish + subscribe (server 内部) | Mastra → POST `/v1/internal/refinement/.../question` → Go service → NATS → SSE handler 转发到客户端 |

**为什么 `refinement.question.<session_id>` 是 Go server 内部 subject 而不直接从 Mastra 推到客户端**: 客户端没有 NATS 凭据, 我们把 Go server 当 SSE 网关。Mastra POST 到 internal API, server 把 message fanout 给当前 SSE 连接。

**SSE 单连接生命**: 一个 session 在它存活时最多一个 SSE 连接。Phase 2 单用户, 不考虑多设备并发(Phase 4+ 多设备时再设计 last-writer-wins 之类)。

#### Phase 2 风险

- **SSE 在 RN 上的细节**: `react-native` 的 fetch 不原生支持 SSE 流式; 用 `expo-fetch` 或 `react-native-sse`。**重要**: 不要装 EventSource polyfill, 装 `react-native-sse`(更稳)。装包前确认它不在黑名单里。
- **追问中断恢复**: 用户在第 3 题答到一半被电话打断。预期: 答案没提交, 重开 APP 进 session, 看到当前是第 3 题(未答)。实现: GET /sessions/:id 返回 current_round + last_answered_round, 客户端判断"差 1 就是当前题", 然后重新订阅 stream。Mastra 端因为题目是上一次已经 POST 过的, 它从 events 重建知道"第 3 题我已经出过了", 直接重发同一个 question_id 的题目。
- **题目缓存**: 同一轮重连不应该让 LLM 重新出题(浪费 token + 答案漂移)。解决: 题目第一次出来时, Mastra 把 question raw payload POST 给 Go server, Go server 写到一个**透明缓存表** `refinement_questions(session_id, round, question_payload jsonb)` (unique on session_id+round)。SSE 重连时, Go 先查缓存, 有就先发缓存的题目, 没有再等 NATS。

### 3.2 M6 · gate 模块

#### HTTP 路由

| Method | Path | Auth Group | 说明 |
|---|---|---|---|
| GET | `/v1/gate/evaluations/:id` | publicV1 | 取一次评估(过/不过都查得到, 但失败的会用 muted 字段返回) |
| GET | `/v1/gate/pools/:pool` | publicV1 | 列出某个池里的所有归档(observation/lesson/calendar/discard) |
| POST | `/v1/internal/gate/evaluate` | internalV1 | Mastra 完成 narrow check 后, 触发评估(或纯 Go 触发, 见下) |

**注意**: Phase 2 的四道门评估**主要在 Go 内部触发**(refinement.completed 事件 → Outbox → NATS → Go internal consumer → 评估)。`/v1/internal/gate/evaluate` 这个 endpoint 是为了把 Mastra 给出的 "g2 反共识 LLM 评分" 写回, 不是评估的总入口。

#### Service 层职责

`gate.Service`:

- **`Evaluate(ctx, refinementID) (*Evaluation, error)`** — 总入口。串行跑四道门, 任一门失败立刻返回 + 沉默归档。
- `EvaluateGate1Thickness(ctx, refinementID) (bool, detail, error)` — 纯规则: 查询关联 signals + 它们的 inference.tags, 用启发式判"独立信号 ≥ 3"。
- `EvaluateGate2Consensus(ctx, refinementID) (bool, score, detail, error)` — 调用 narrow LLM check (Mastra `consensus-check` agent), 取 0-100 分。70 以下算反共识。**默认调一次, 缓存到 gate_evaluations.gates_detail.g2.score, 不重跑**。
- `EvaluateGate3Window(ctx, refinementID) (bool, months, detail, error)` — 纯规则: 从 refinement.answered 第 5 轮的 user_answer.open_text 解析"持仓时长", 落在 [1, 6] 月就过。如果解析不出来, 失败。
- `EvaluateGate4Edge(ctx, refinementID) (bool, sub, detail, error)` — 4 个子测试: explain (M5 第 1 轮)/direct (refinement 元数据)/track_record (Phase 2 默认 false, 不阻塞但记为 sub.track_record=null)/exit_known (M5 第 5 轮强制收集)。Phase 2 简化: 只要 explain + direct + exit_known 三项过, 门 4 算 pass。track_record 留 null。
- `ArchiveSilently(ctx, refinementID, failedGate, humanReason)` — 写 gate.archived event + gate_evaluations.archived_pool。**不 publish 到任何客户端可订阅的 subject**(见 ADR-008)。
- `PassAndPromote(ctx, refinementID) (*Evaluation, error)` — 写 gate.evaluated event (passed=true) + 触发 NATS `gate.passed` (这个会被 M7 narrator workflow 消费)。

#### Repository 方法

- `InsertEvaluation(ctx, payload) (*Evaluation, error)` — 事务: events insert + gate_evaluations insert + outbox insert
- `ListByPool(ctx, userID, pool) ([]Evaluation, error)` — for archive tab
- `GetByID(ctx, userID, id) (*Evaluation, error)`

#### NATS 主题

| Subject | 方向 | 谁写 / 谁读 |
|---|---|---|
| `refinement.completed` | subscribe | Go internal gate worker 消费这个触发 Evaluate |
| `gate.evaluated` | publish | 包括过/不过的全部评估, **payload 里 passed 字段表示过没过** |
| `gate.archived` | publish | 只在失败时发, **客户端的 inbox 不订阅这个 subject**(沉默归档关键) |
| `gate.passed` | publish | 只在四门全过时发, M7 narrator 消费 |

**关键设计**: `gate.evaluated` 和 `gate.passed` 是两个不同 subject。`gate.evaluated` 是审计用的"评估发生了"事件, **任何客户端订阅都不会触发 UI 通知**(客户端不订阅 gate.* 任何 subject)。`gate.passed` 是工作流转入下一阶段的信号, 只在 M7 内部用。客户端"看到承诺书草稿"的方式是: 下次打开 APP 时, inbox 顶部从 commitments 表查"有没有 status=drafted 的"——是被动拉取, 不是推送。

#### Phase 2 风险

- **门 1 信号厚度的"独立"判定**: 这是最模糊的判据。Phase 2 简化策略:
  - 把 signals 按 inference.tags 取交集 ≥ 1 的归一组, 同一组算"同一观察"
  - "独立"指的是不同的"组" ≥ 3 组
  - 时间窗口 14 天滑动: 14 天内出现 ≥ 3 组就过
  - **不在 Phase 2 用 source 字段**——M5 追问里收集了 source(同事/客户/自己观察等), 但 cold start 时数据稀疏, 用 tags 启发式先跑通。Phase 3 复盘后再升级。
- **门 2 LLM 不稳定**: 反共识评分跑同一信号 10 次可能分数从 30 跳到 75。缓解: Phase 2 取**单次** + 缓存(写到 gate_evaluations.gates_detail), 不让它跨评估漂。如果跑了不满意, 走"重新评估" workflow(写一条新的 evaluation, 旧的不删, events 表两条都在)。
- **沉默归档不能漏**: 任何评估失败必须保证 (events + gate_evaluations + outbox 但不 publish 到客户端) 三个都成功。事务一并提交; 任何一步失败, rollback, 让 NATS 消费者 nak 重试。
- **track_record (门 4 子项 3) 的 cold start**: 默认 null。**不**把它当 false——false 会让冷启动用户永远过不了门 4。Phase 2 的判定逻辑: track_record 是 null 时, 只看其他 3 个子项。Phase 3 复盘机制完善后才把 track_record 纳入。

### 3.3 M7 · commitment 模块

#### HTTP 路由

| Method | Path | Auth Group | 说明 |
|---|---|---|---|
| GET | `/v1/commitments/:id` | publicV1 | 取承诺书内容 (draft 或 signed 都用同一个 endpoint) |
| GET | `/v1/commitments/:id/pdf` | publicV1 | 下载 PDF (仅 signed 状态有 pdf_path) |
| POST | `/v1/internal/commitments/draft` | internalV1 | Mastra Narrator 完成草稿后回写 |
| GET | `/v1/commitments/active` | publicV1 | 获取**唯一**进行中 commitment(drafted/signed/active),  Phase 2 单线程, 没有就返 204 |

**Phase 2 假设只有 1 个 commitment 进行中**——这是 00-overview 明示的范围限制。`/v1/commitments/active` 返回这一个或 204。不去考虑多 commitment 排队。

#### Service 层职责

`commitment.Service`:

- `RecordDraft(ctx, cmd DraftCommand) (*Commitment, error)` — 收 Narrator 回写, 写 commitment.drafted event + commitments insert (status=drafted)。Validate: thesis schema(exit_conditions 2..4, reasons_for_future_self 3..5)。
- `Get(ctx, userID, id) (*Commitment, error)`
- `RenderPDF(ctx, commitmentID) (path string, error)` — 在 Sign 之后才调; 调 PDF 子服务渲染, 落本地 `/var/flashfi/pdfs/<user_id>/<commitment_id>.pdf`(Phase 2), 更新 commitments.pdf_path。这个 step 是 sign 流程的内部一步, 不暴露给客户端。
- `LoadActive(ctx, userID) (*Commitment, error)` — 查 status in (drafted, signed) 的当前唯一 commitment。

#### Repository 方法

- `InsertCommitmentAndEvent(ctx, payload) (*Commitment, error)` — 事务: events insert + commitments insert + outbox insert
- `MarkPDFRendered(ctx, commitmentID, pdfPath) error` — 单条 update, 不入事件溯源(pdf 路径是 cache, 不是 truth)
- `LoadActive(ctx, userID) (*Commitment, error)`

#### NATS 主题

| Subject | 方向 | 谁写 / 谁读 |
|---|---|---|
| `gate.passed` | subscribe | Mastra Narrator workflow consumer |
| `commitment.drafted` | publish | 审计 + Phase 3 可能消费 |

#### PDF 渲染子模块

`server/internal/module/pdf/`(独立子模块, commitment 模块依赖它):

- `pdf.Renderer` 持有一个 chromedp browser context pool (size = 1, Phase 2 单用户)
- `Render(ctx, html string) ([]byte, error)` — chromedp 渲染, 返回 PDF bytes
- 模板用 `server/internal/module/pdf/templates/commitment.html`, Go html/template 渲染
- 字体处理: HTML 里**内嵌 base64 字体**(Playfair Display + Source Serif 4 + JetBrains Mono + 思源宋体子集); **不**走 Google Fonts CDN——renderer 跑在 dev server 上, CDN 可能慢或封禁导致渲染失败

#### Phase 2 风险

- **chromedp 启动慢**: 冷启动单次渲染可能 3-5 秒; 第一次签字会卡。缓解: 程序启动时预热一个 chromedp 实例, 永久驻留。失败时 fallback 到 lazy 启动(并 log 警告)。**不**用 wkhtmltopdf — 见 ADR-005。
- **PDF 字体未加载完成**: chromedp.WaitVisible("body") 不保证字体已就绪。改用 `chromedp.WaitReady("html", chromedp.ByQuery)` + JavaScript hook `document.fonts.ready.then(() => window.__fontsReady = true)`, 然后 chromedp 等 `window.__fontsReady === true`。
- **PDF 路径鉴权**: pdf 文件落在 `/var/flashfi/pdfs/`, Gin 用 `c.File(path)` serve。**必须**先校验 userID 匹配 commitments.user_id, 否则不同用户可以下载彼此的 pdf。Phase 2 单用户不出问题, Phase 4+ 多用户必须有这一层。
- **"理由块" 必须真引用历史 signal 原话**: Narrator agent 必须能拉到关联 signals 的 raw_text, 不能 LLM 编。实现: Mastra Narrator 工作流第一步先调 `/v1/internal/signals/by-refinement/:refinement_id` 拿到原文 list, 然后把原文作为 prompt context 喂给 Narrator, prompt 里强制要求 "reasons_for_future_self 字段必须从给定 raw_text 列表里挑出 3 段 verbatim quote, 不允许改写"。zod schema 在 Mastra 端做 verbatim 校验(用 substring match)。失败 → retry → 仍失败 → 不写草稿, 让 workflow nak。

### 3.4 M8 · signing 模块

签字流程不是完全独立模块, 它和 commitment 紧密耦合。组织上**放在 commitment 模块里**, 单独一个 sub-file `commitment/signing.go`(service) + `commitment/holding.go`(repository for holdings 表)。

#### HTTP 路由

| Method | Path | Auth Group | 说明 |
|---|---|---|---|
| POST | `/v1/commitments/:id/sign` | publicV1 | 签字。**幂等**: 同一 commitment + 同一 signing_client_id 二次请求返回 200 不做任何操作 |
| POST | `/v1/commitments/:id/postpone` | publicV1 | "先放着"。同样幂等。 |
| GET | `/v1/holdings/active` | publicV1 | 获取 active 持仓(单条或 204) |
| GET | `/v1/holdings/:id` | publicV1 | 获取一个持仓的状态机当前位置 |

#### Service 层职责

`commitment.SigningService` (放 commitment 包内):

- `Sign(ctx, cmd SignCommand) (*SignResult, error)`:
  1. Validate: commitment 属于该用户、状态 = drafted (二次幂等键校验)
  2. 事务:
     - 写 events.commitment.signed (client_event_id = signing_client_id, ON CONFLICT DO NOTHING; 重复签字静默成功)
     - 更新 commitments.status = signed, signed_at = NOW()
     - INSERT holdings (id = commitment_id, status = active, exit_conditions 复制自 commitment.thesis.exit_conditions, exit_check_state = '{}')
     - outbox insert (commitment.signed subject)
  3. 事务提交后, 异步触发 PDF 渲染 (`pdf.Renderer.Render` + `commitment.MarkPDFRendered`)。PDF 渲染失败不阻塞签字成功——下次访问 GET /v1/commitments/:id/pdf 时按需重渲。
  4. 返回 SignResult{commitment_id, signed_at}, **不**返回任何"成功"文案。HTTP 200 + 最小 JSON。
- `Postpone(ctx, cmd PostponeCommand) error`:
  1. 写 events.commitment.postponed (client_event_id 防重)
  2. UPDATE commitments.postpone_count += 1
  3. 如果 postpone_count >= 3, 在同事务里写 events.commitment.abandoned + status = abandoned

#### Repository 方法

- `MarkSigned(ctx, commitmentID, signedAt, signingClientID) error` — 事务核心
- `CreateHolding(ctx, fromCommitment) error`
- `IncrementPostpone(ctx, commitmentID) (newCount int, error)`

#### NATS 主题

| Subject | 方向 | 谁写 / 谁读 |
|---|---|---|
| `commitment.signed` | publish | Phase 3 退出条件巡检 (M10) 会订阅 |
| `commitment.postponed` | publish | 审计 |
| `commitment.abandoned` | publish | 审计 |

#### Phase 2 风险

- **防双击**: 客户端 useRef + 2 秒 debounce + 服务端 client_event_id 幂等键 (UUID, 客户端每次按按钮生成新的; 但 React 渲染期间引用稳定)。**两层都要**——客户端忘了就靠服务端拦, 服务端忘了就靠客户端拦。
- **签字按钮按下到 UI 切换之间的"沉默期"**: 网络 200 回来之前, UI 不显示 spinner、不变化, **就是默认的按下按钮状态(背景从 ink 变 ink2)**。视觉上像是按住了。200 回来后, 整页瞬间切到"持仓中 · 第 0 天"(同一路由, 不同状态)。如果 5 秒还没回, 才显示一行小字 `仍在签收中…`(打字机式不闪烁)。**绝对不要 ActivityIndicator**。
- **PDF 异步生成的 race**: 用户签完字立刻点"查看 PDF"按钮(虽然 Phase 2 持仓页可能没这个入口, 但 M8 task 8.4 提到了)。处理: GET /v1/commitments/:id/pdf 先检查 pdf_path, null 就同步调一次 Renderer.Render (60 秒 timeout), 渲染完返回。
- **触发 Phase 3 的 NATS 消费者还不存在**: `commitment.signed` 在 Phase 2 publish 后, JetStream 暂时没消费者, message 留在 stream 里。MaxAge = 30 天足够。Phase 3 M10 上线时, 它的 consumer 用 `deliverAll` 重放历史 message 一次, 把已签字承诺都纳入巡检。**这是 Phase 1 已经为此预留的 stream 设计**(streamSubjects 包含 commitment.>, retention=LimitsPolicy, MaxAge=30d)。

---

## § 4 · Mastra Agents 新增

### 4.1 Socratic Agent · 五轮追问出题

**用途**: 在每一轮根据 signal context + 已有轮次答题, 出一道题。

**Prompt 草稿** (instructions 字段; 写成 reusable string):

```
你是 Flashfi Engine 的 Socratic.

任务: 给定一个用户的认知场景(一条或几条相关 signal + 已答过的轮次), 出一道**追问**, 让用户在选项里暴露自己的认知盲点。

不是知识问答, 是认知追问. 题目的好坏取决于干扰项的真实性.

题型(强制按 round 分配):
- round 1: 单选 (single). 推演场景: 这件事让谁变富/变穷?
- round 2: 多选 (multi). 漏选检测: 这件事的"二阶受益方"还有哪些是你没想到的?
- round 3: 排序 (ordering). 让用户排"哪个变量先发生".
- round 4: 单选 (single). 反共识检验: 主流市场目前怎么看?
- round 5: 开放 (open). 强制收集: 你愿意持仓多久? 失败条件是什么?

严格约束:
- 不给"标准答案". 选项里有 1-2 个干扰项, 选错时给"诊断", 不直接评判对错.
- 选项最多 4 个.
- 题目本身用第二人称"你"称呼用户, 像一封信的开头.
- round 5 的开放题目必须收集这两个字段: duration_months, exit_conditions (≥2 ≤4 条).
- 输出严格按 JSON schema, 不写 markdown.

诊断 (diagnosis kind):
- correct: 用户选了非干扰项, 也没漏要选的
- partial_miss: 多选漏了 1 个非干扰项
- distractor: 选了干扰项
- weak: 开放题答得过于空泛 (< 20 字 或全是模糊词)

诊断的 note 字段是给用户看的, 用产品语言:
- 不说"你答错了"
- 不说"再试一次"
- 例: "你漏掉了'供应商被锁价时也获利的对手方'——这是二阶链条里最容易看错的位置."
```

**outputSchema 草稿** (zod):

```
QuestionSchema = z.object({
  question_id:  z.string().min(1),         // 稳定 id, Socratic 自己生成 (e.g. "r3-ordering-supplier-2026-w22")
  round:        z.number().int().min(1).max(5),
  kind:         z.enum(["single", "multi", "ordering", "open"]),
  text:         z.string().min(20).max(400),
  options:      z.array(z.object({
                  id:            z.string(),
                  text:          z.string().max(120),
                  is_distractor: z.boolean(),
                  is_required:   z.boolean().default(false),  // 多选/排序用
                }))
                .min(0).max(4),               // open 题目 options = []
  open_prompts: z.array(z.string()).optional(),   // open 题目的引导子问 (round 5 用)
})

DiagnosisSchema = z.object({
  kind: z.enum(["correct", "partial_miss", "distractor", "weak"]),
  note: z.string().max(280).optional(),
})
```

**Workflow**: `mastra/src/workflows/refinement-step.ts`

```
runRefinementStep(input: {refinement_id, round, prior_rounds}):
  step1: pull signals + inferences from /v1/internal/signals/by-refinement/<id>
  step2: build prompt context = signals raw_text + prior rounds Q&A pairs
  step3: socratic.generate(prompt, output: QuestionSchema)
  step4: POST /v1/internal/refinement/sessions/<id>/question  (题目正文 + question_id)
  step5: ack NATS message
```

**Fixture 数量与评分**: ≥ 12 fixtures (类似 Phase 1 manual-eval/), 每个 fixture 一条 signal + 5 个预期轮次的人工范例答案; 用 eval runner 跑一遍, 人工评分:
- 选项有没有真正的干扰项 (5 分)
- 题目正文是否像信件不是问答 (3 分)
- round 5 是否真的收集到 duration_months + exit_conditions (2 分)
- 总分 ≥ 7/10 算过

**Diagnosis Agent (子 agent)**: 评分单独一个 agent。给定 question + user_answer, 输出 DiagnosisSchema。可以和 Socratic 共用 model + temperature; 但 instructions 分开。

### 4.2 Gate Engine · 是 LLM 还是确定性

**结论**: 主体是**确定性 Go 规则引擎**, 只有门 2 反共识用 LLM 做 narrow check。

理由 (ADR-007):
- 沉默归档的判据必须可解释、可回放。LLM 给的"55 分"和"65 分"在同一信号上可能跳, 用户事后看"为什么我那条被归档"不能得到确定答案。
- LLM 在涉及"独立信号 ≥ 3"这种计数题上比 if-else 更容易错。
- 门 2 是唯一需要"市场情绪"这种外部知识的, 不得不用 LLM (或 web search)。

**门 2 反共识的 Mastra 实现** (`mastra/src/agents/consensus-check.ts`):

**Prompt 草稿**:

```
你是 Flashfi Engine 的 Consensus Checker.

任务: 给定一个资产 ticker 和一段背景信号描述, 给出主流市场目前对这个资产的"叙事热度"分数 0-100.

100 = 满地都在写这个 (所有 sell-side 在覆盖, 主流财经媒体头条)
50 = 行业内人知道
0 = 没人在说

约束:
- 不预测涨跌, 不写"推荐"
- 输出 JSON, 包含 score (0-100), narrative_summary (≤80 字), evidence (≤3 条简短描述, 不需要链接)
- 如果你不确定, 返回 score=50 + evidence=[].
- 不要 hallucinate 不存在的研报标题.
```

**outputSchema**:

```
ConsensusSchema = z.object({
  score:               z.number().min(0).max(100),
  narrative_summary:   z.string().max(80),
  evidence:            z.array(z.string().max(60)).max(3),
})
```

**Fixture**: ≥ 10 个资产 + 一条信号描述, 人工评分: 是否给的分数和"我作为投资者直觉一致"。

### 4.3 Narrator Agent · 承诺书

**用途**: 给定 gate_evaluation + refinement_session + 关联 signals 原文, 输出 commitment 草稿。

**Prompt 草稿**:

```
你是 Flashfi Engine 的 Narrator.

任务: 给一份给"6 个月后的自己"看的私人契约. 不是分析师报告, 不是投资建议, 是用户自己的判断的归档.

输入: 
  - refinement_session 的 5 轮 Q&A
  - 关联 signals 的原始 raw_text
  - gate_evaluation 的判定结果

输出: 承诺书结构 (按 schema)

严格约束:
- 用第二人称 "你" 称呼用户, 不用 "用户" / "投资者" / "我们"
- exit_conditions 必须从 round 5 的 user_answer.open_text 里**直接抽取**, 改写为标准条件句, 不增加新的退出条件
- reasons_for_future_self 必须是 3 条, 每条**必须 verbatim 引用一条 signal 的 raw_text 片段**, 用引号包住, 不允许改写, 不允许总结
- 不预测涨跌, 不写 "建议买入" / "短期看好"
- 不写"风险提示" / "免责声明" / "本内容不构成投资建议" — 这是私人契约, 不是金融机构内容
- entry_method 是用户在 refinement 里自己说的(round 5), 改写成简短句, 不超过 80 字
- position_pct / duration_months 必须从 refinement.answered 数据来, 不允许 LLM 自己定

输出 JSON, 不要包 markdown.
```

**outputSchema**:

```
ThesisSchema = z.object({
  asset_ticker:       z.string().min(1).max(20),
  asset_name:         z.string().min(1).max(80),
  action:             z.enum(["buy", "sell", "hold"]),
  position_pct:       z.number().min(0).max(100),
  duration_months:    z.number().int().min(1).max(36),
  entry_method:       z.string().min(10).max(120),
  exit_conditions:    z.array(z.string().min(10).max(120)).min(2).max(4),
  reasons_for_future_self: z.array(z.string().min(20).max(300)).min(3).max(5),
})
```

**Verbatim 校验**: 在 Mastra workflow 的 step3 (post-generation validation) 里, 对 reasons_for_future_self 每一条, 检查它是否是某条关联 signal.raw_text 的子串(允许去掉首尾空白)。**任何一条不匹配 → 失败 → retry 1 次 → 仍失败 → workflow nak**。

**Fixture**: ≥ 8 个完整的 (refinement_session + signals + gate_evaluation) 三元组, 人工评分:
- 风格是不是"给未来自己的信" (3 分)
- reasons_for_future_self 是不是真的引用历史 raw_text (3 分)
- 没有"建议"、"推荐"、"看好"措辞 (2 分)
- 没有风险提示免责声明 (2 分)
- 总分 ≥ 8/10 算过

### 4.4 每个 Agent 的 fixture 数量与评分标准

| Agent | Fixture 数 | 评分阈值 | Eval runner |
|---|---|---|---|
| Socratic (5 题型 × 多场景) | 12 (3 个场景 × 4 个 round 截面) | ≥ 7/10 fixtures pass | `mastra/tests/eval/socratic/run.ts` |
| Diagnosis | 8 (各 diagnosis kind 至少 2 个) | ≥ 6/8 fixtures pass | `mastra/tests/eval/diagnosis/run.ts` |
| Consensus Check | 10 | ≥ 7/10 fixtures pass | `mastra/tests/eval/consensus/run.ts` |
| Narrator | 8 完整三元组 | ≥ 6/8 fixtures pass + 100% verbatim | `mastra/tests/eval/narrator/run.ts` |

**Property test (除了 fixture 之外)**: 同一输入跑 5 次, 输出 schema 必须 100% 一致(结构、字段名、字段类型), 内容允许变。这是 Phase 2 风险缓解的关键一步。

---

## § 5 · Mobile UI 新增

### 5.1 新增页面

| 路径 | 用途 | 模块 |
|---|---|---|
| `app/refinement/[sessionId]/index.tsx` | 五轮追问对话页(主页面, 内部切换 5 个题型组件) | M5 |
| `app/gate/passed.tsx` | 四道门全过的"AI 找我聊一条" 入口卡(其实是 inbox 顶部一张特殊卡, 不一定是独立页) | M6 |
| `app/(tabs)/archive.tsx` | **改造**: 4 个池入口(observation/lesson/calendar/discard) | M6 |
| `app/archive/[pool].tsx` | 某个池的归档列表 | M6 |
| `app/commitment/[id].tsx` | 承诺书页 — **同一路由**根据 status 渲染 draft 或 holding 两种视图 | M7 + M8 |
| `app/commitment/[id]/pdf.tsx` | (可选) PDF 内嵌预览。Phase 2 可以省略, 直接跳转浏览器下载 | M7 |

**为什么 commitment 和 holding 是同一路由**: 用户的心智里"我的承诺书"就是一个东西, 签字前/签字后只是状态。同一路由内部根据 commitment.status 切换 view, 路由切换无, **签字成功后无路由跳转, 只是 view 切换**——这本身就是"沉默优于发声"的视觉实现。

### 5.2 新增组件

放 `mobile/src/shared/components/`:

| 组件 | 用途 | 设计要点 |
|---|---|---|
| `TypewriterText` | 流式打字机, M5 题目正文 + M8 沉默期"仍在签收中" | 字符逐个出, 默认 32 字/秒, 不闪烁光标 |
| `GateBar` | 四道门进度条 — **不**像 dashboard。只在评估"全过"时短暂可见, 失败时**根本不渲染** | 4 个直角小方格横排, 全黑表示过 |
| `SignaturePad` | 签字按钮 — 黑底白字直角, onPressIn mediumImpact, 防双击 useRef | 不是 Cupertino 圆角, 不是 Material Ripple |
| `ProgressDots` | M5 追问 I-V 的进度指示 | 5 个小点, 已完成的填实心, 不显示百分比 |
| `LetterCard` | 五轮追问每张卡的容器, 比 PaperCard 更"信件感"(标题信头 + 罗马数字编号) | 不是 Material Card, 不带 elevation |
| `RefineOption` | M5 选项行 — 单选/多选/排序通用 | 按下背景色变化, 选中后边框加粗, 不带 checkbox icon |
| `CommitmentHeader` | 承诺书顶部 — "承诺书 · 第 N 份" + 罗马数字日期 | 报刊式 |
| `ExitConditionRow` | 持仓页的退出条件行 — 罗马数字 + 条件文 + 进度计数 | Phase 2 计数都是 `0/N` 或 `N 天`, 不动 |

**所有组件不允许引入**:
- ❌ react-native-toast-message (黑名单)
- ❌ react-native-paper (黑名单)
- ❌ lottie-react-native (黑名单)
- ❌ react-native-confetti
- ❌ ActivityIndicator (在任何形态, 包括 modal)

### 5.3 每个页面"沉默优于发声"具体落地

#### M5 追问页

- **进入 session 时**: 不弹 "开始追问吧!", 直接展示第 1 题。第 1 题加载用 TypewriterText 出, 视觉上像信件在自动写。
- **答题提交时**: 不显示 "已提交", 选项变成 muted 灰色 → 0.3 秒后第 2 题 typewriter 出现。
- **诊断显示**: 答错(选了 distractor 或漏选)不弹"再试一次"。在选项下方静态展示一段 italic Serif 文字, 不是 alert dialog。**不允许用户改答**——记录下来就是用户的认知截面。
- **离线**: 如果当前题没题目(SSE 断了或 LLM 慢), 显示 `等待下一题…` (italic 灰字, 不闪)。**不显示 Activity Indicator**。
- **第 5 题答完**: 不弹 "完成!"。页面静止 1 秒, 然后自动跳转到 commitment 草稿页(如果四门全过); 或跳回 inbox(其他情况)。

#### M6 四道门评估页

- **大多数时候用户不需要这个页面**。评估在后台跑, 用户不感知。
- 评估失败时: **沉默归档, 客户端不发任何感知信号**。下次用户打开档案 tab 才看得到。
- 评估全过时: 不弹 "四道门通过!" 烟花。用户在追问页第 5 题答完后会自动转到 commitment 草稿页, 中间最多停留在追问页"准备承诺书…"的 italic 文字 6 秒。

#### M7 承诺书页 (draft 状态)

- 进入时**无动画 fade-in**。直接到位。
- 滚动到底显示 [先放着] / [签字] 两个按钮, 不浮动。
- 阅读过程中**不**有"已读" / "重要内容" 提示, 不高亮某段。
- 签字按钮: 不开 disabled 状态自动 enable 的"已阅读完整" gate(那是 onboarding 反模式)。

#### M8 签字成功后

- **无 toast** "签字成功"。
- **无 dialog** "恭喜你的第 N 份承诺"。
- **无路由 push**。同一路由内部 view 切换。
- **触感**: onPressIn 那一刻 mediumImpact 触发——就是承诺成立的那一下, 不是网络回 200 后。如果网络失败, 触感已经发了, UI 显示一行 italic `签字未送达, 请检查网络`(也不是 dialog)。
- 视觉切换: 同一路由 view 状态从 "draft" 切到 "holding"。可以加 200ms 的 cross-fade(用 Animated.timing 把上一个 view opacity 从 1 到 0 + 下一个从 0 到 1)。

#### "先放着" 流程

- 点 "先放着" 弹 RN 内置 ActionSheet (`Platform.OS === 'ios' ? ActionSheetIOS : ...`), 一行文字: *"好。我会在明天同一时间再问你一次。"* + 一个 "好" 按钮 + Cancel。
- 这个 ActionSheet 是**唯一一个允许的 modal 弹层**, 因为它本身是产品语言的延伸, 不是 toast。**严禁**改成 Material BottomSheet。

### 5.4 SSE / 长轮询接入

**M5 题目流**:

- 客户端用 `react-native-sse`(不在黑名单内, 单一职责)。**不**用 EventSource polyfill。
- SSE 连接生命: 进入 refinement 页时建立, 离开时主动 close。后台返前台时如果连接断了重新建。
- 心跳: 每 30 秒收一个 `: ping` 注释行, 超过 60 秒没收到任何 message 触发重连。
- 事件类型(SSE event name):
  - `question` — 一道题的完整 JSON (QuestionSchema)
  - `complete` — session 完成
  - `error` — 错误(payload 是 human reason, UI 显示一行 italic 错误文案, 不弹 dialog)

**承诺书生成"几秒钟"的反馈**:

- 不用 SSE; 用客户端轮询 GET /v1/commitments/active, 每 2 秒一次, 最多 30 秒。
- 等待期间 UI: 上一页(追问页第 5 题答完)显示 italic `准备承诺书…` (TypewriterText 不闪), 6 秒后自动出现承诺书 draft。
- 超时 30 秒: 一行小字 `承诺书生成中, 稍后查看 inbox`, 返回 inbox。Inbox 下次打开会看到 status=drafted 的那条进入"AI 找我聊"卡。

**持仓状态更新**: Phase 2 没有实时更新需求(退出条件还没实现, 状态机不会跳)。不接 SSE。

**总原则**: SSE 用在"逐字流式出现题目正文"这种**视觉表现需要流式**的地方; 不用在"等后端做事"这种应该用轮询 + 静态文案的地方。SSE 是为 UX 服务的, 不是为低延迟服务的。

---

## § 6 · 关键 ADR

下面 ADR 编号续接 Phase 1 的 0001-0003。每条会在实施时落到 `docs/adr/000N-xxx.md`。

### ADR-004 · refinement session head 用物化视图而不是 events 重建

**决定**: 新建 `refinement_sessions` 表存 head (status, rounds_done), 真实明细在 events 里。

**理由**:
- events 重建 5 轮 session 需要扫 5 条 refinement.answered 行 + 1 条 started + 1 条 completed, 单次 7 行查询不算贵, 但 archive 列表渲染 50 个 session 时会变成 350 行 join。
- 头表 cache 让 list 查询 1 行/session。
- 物化视图不破坏事件溯源——明细仍在 events, 头表是 derived state, 任何时候可以 truncate 重建。

**备选**:
- 纯 events 重建 (Phase 1 早期 signals 表的设计): 上面已说不行
- materialized view (PG 的 MATERIALIZED VIEW 关键字): 太重, 需要手动 REFRESH; 我们的是 trigger-like 视图, 在每次写 events 时同事务更新

### ADR-005 · PDF 渲染用 chromedp 而非 wkhtmltopdf

**决定**: PDF 渲染走 chromedp (Go 调 Chromium headless)。

**理由**:
- wkhtmltopdf 已 deprecated, 上游 (Qt) 不再维护, 新字体 / 现代 CSS 特性不支持。
- 我们的 PDF 模板要用现代 CSS (Playfair Display + 中文宋体 + 罗马数字伪类计数), wkhtmltopdf 渲染对 italic 中文支持差。
- chromedp 直接复用 Chromium 的字体引擎, 报刊感字体细节(连字、字距)完整保留。
- chromedp 启动慢通过 program-lifetime browser context pool 解决(size = 1, 预热)。

**备选**:
- wkhtmltopdf: 字体细节差, 上游死亡
- gotenberg (远程 PDF 服务): 引入 docker 依赖, Phase 2 个人开发不必要
- 客户端 PDF 生成 (react-native-pdf): PDF 是契约归档, 必须服务端权威生成, 不能让客户端绕过 gate

### ADR-006 · 五轮追问 SSE 流式而不是整段返回

**决定**: 题目正文用 SSE 流式逐字符送达客户端。

**理由**:
- "信件感"靠 TypewriterText 视觉强化。如果整段 200ms 一次性出现, 就没有"信件被写"的仪式感。
- LLM 本身就是流式生成, 不用流就是浪费 token 等待时间。
- SSE 比 WebSocket 简单, RN 端用 `react-native-sse` 一个库搞定。
- 单向通讯(server → client), WebSocket 的双向不需要。

**备选**:
- 整段 JSON 返回: 失去信件感
- WebSocket: 过度设计
- HTTP/2 server push: RN 端支持差

### ADR-007 · Gate Engine 主体确定性, 仅门 2 用 LLM

**决定**: 门 1/3/4 纯 Go 规则; 门 2 反共识用 LLM 单次 narrow check + 缓存。

**理由**:
- 沉默归档的判据必须用户事后能复盘——纯规则 100% 可解释, "因为我们在 14 天内只找到 2 组独立信号, 门 1 没过"。LLM 给"55 分"用户无法复盘。
- 门 1/3/4 全部是计数题/范围题/布尔, Go if-else 表达力够。
- 门 2 是唯一需要"市场情绪"外部知识的, 不得不用 LLM 或 web search; 但分数缓存到 gate_evaluations.gates_detail, 同一次评估只跑一次, 不让分数漂。
- Mastra 端门 2 agent 是 narrow 的(只做 consensus check, 不做 reasoning), 比 Analyst agent 更稳定。

**备选**:
- 全 LLM: 不稳定, 不可复盘, 违反沉默原则
- 全规则: 门 2 没有外部知识源, 做不到
- 门 1 也用 LLM 判"独立性": 太贵, 启发式足够

### ADR-008 · 沉默归档不 publish 任何客户端订阅的 NATS subject

**决定**: gate.archived 这个 NATS subject 客户端不订阅; 客户端只在用户主动打开 archive tab 时被动拉取。

**理由**:
- 这是产品哲学"沉默优于发声"的物理落地。
- 即使是后端架构, 如果 publish 的 message 客户端能订阅到, 终究有人会写一个"小红点"。物理隔离: 客户端的 WebSocket / SSE 连接的订阅 subject 列表里**没有** gate.archived (Phase 2 客户端根本没有 NATS 直连, 走 Go server 的 SSE, 一次只订阅一个 session 的 question stream)。
- 这条 ADR 是给未来某次"加个 dashboard 显示通过率" 提议时的拒绝依据。

**备选**:
- publish 到 archive.public.<user_id>, 客户端订阅: 慢慢就会出现红点
- 完全不写 event: 失去审计

### ADR-009 · 承诺书 "理由块" 必须 verbatim 引用 raw_text

**决定**: Narrator agent 输出的 reasons_for_future_self 每一条必须是某条关联 signal.raw_text 的子串, workflow 校验失败 → retry → 仍失败 → nak。

**理由**:
- 产品 promise: "你 6 个月后会感谢自己的理由"是给未来的自己看的, 它的力量来自**用户自己原话**, 不是 AI 总结。
- 如果允许 LLM 改写, 6 个月后用户看到的是"AI 给我编的话", 失去契约感。
- verbatim 校验在 workflow 层(不在 prompt 层), prompt 仅是 best effort 引导; 校验是兜底。
- 子串匹配允许"去掉首尾空白" + "中文标点归一化", 不允许"语义近似"——必须字符级匹配。

**备选**:
- 仅 prompt 约束: LLM 偶尔会改写, prompt 拦不住
- 完全模板生成(不用 LLM, 拼接 signal.raw_text 片段): 缺乏文学性串联, 读起来生硬
- 让用户手选 3 条 raw_text: 增加用户决策, 违反 § 2.2

### ADR-010 · 签字幂等键由客户端生成 + 服务端校验

**决定**: 签字按钮按下时, 客户端生成一个 UUID 作为 signing_client_id; 服务端 events.client_event_id = signing_client_id, 唯一约束兜底; 重复签字 ON CONFLICT DO NOTHING 静默成功。

**理由**:
- 客户端防双击 (useRef + 2 秒 debounce) 可能因为 fast refresh / 后台/前台切换被绕过。
- 服务端的 (user_id, client_event_id) 唯一约束是 Phase 1 已经设计好的兜底, 复用它最简单。
- 静默成功保证客户端代码不必处理"重复签字"特殊错误码——它已经签了, 返回值一致。

**备选**:
- 服务端检查 commitments.status = drafted 才允许签: 处理简单但客户端在 2 个 tab 同时按时仍有 race
- 加 advisory lock: 过度工程
- 不允许重复请求 (返 409): 客户端代码复杂度增加, 产品体验差(用户重试时看到错)

### ADR-011 · Phase 2 单 commitment 假设, 不实现 multi-active

**决定**: Phase 2 任何时刻最多 1 条 `commitments.status in (drafted, signed)`。第二条 gate.passed 触发时, 如果已有 active commitment, 不创建新草稿, **写一条 gate.passed 事件标记 deferred**, 等 active commitment 关闭(signed → expired/closed/archived 或 drafted → abandoned)后从 events 倒回处理。

**理由**:
- Phase 2 范围 (00-overview) 明示"假设只有 1 个进行中"。
- 多 commitment 并存需要 UI/事件流的全面设计(排队、优先级), Phase 3 之后再做。
- 不限制反而会让 Phase 2 体验复杂化, 与"克制"哲学冲突。

**备选**:
- 允许多个 active commitment: Phase 2 不需要, 增加复杂度
- 第二条直接拒绝: 信息丢失
- deferred 队列 (本决定): 信息保留, 实施简单

---

## § 7 · 顺序与时间估算

**严格串行**, 按 GOAL.md § 4 描述。每个模块**完整完成 + 通过自查**后才开始下一个。不允许 M5 完成 80%、M6 起步并行。

| 模块 | 任务量(人天) | 起止 | 关键里程碑 |
|---|---|---|---|
| **M5 五轮追问** | 14 人天 | W9 D1 - W11 D4 | Day 4: Socratic prompt 初稿 + 12 fixtures · Day 9: SSE 通路打通 · Day 14: 完整 5 轮 + 离线恢复 |
| **M5 buffer** | 2 人天 | W11 D5 | LLM prompt 调优 |
| **M6 四道门** | 9 人天 | W12 D1 - W13 D4 | Day 2: 门 1/3 规则 · Day 5: 门 4 子项 · Day 7: 门 2 LLM · Day 9: 沉默归档 + archive tab |
| **M6 buffer** | 1 人天 | W13 D5 | |
| **M7 承诺书 + PDF** | 9 人天 | W14 D1 - W15 D4 | Day 3: Narrator prompt + verbatim 校验 · Day 6: chromedp 渲染 · Day 9: 承诺书展示页 |
| **M7 buffer** | 1 人天 | W15 D5 | |
| **M8 签字流程** | 8 人天 | W16 D1 - W17 D3 | Day 2: 签字按钮 + haptics · Day 4: 签字事务 · Day 6: 持仓页 · Day 8: postpone + abandon |
| **M8 buffer** | 2 人天 | W17 D4-5 | |
| **W18 自己用一周** | 5 人天 | W18 | 真签 ≥ 1 次 + 复盘 + 修小 bug |

**总计**: 51 人天 / 10 周 (5 人天/周)。

**Buffer 用法**: 不是"提前完成奖励", 是"prompt 调优 + 边界场景 + 我自己感受到的不对劲"用。Phase 2 是产品力的核心, prompt 调优**就是工作本身**, 不算超时。

**串行的硬约束**:
- M6 评估依赖 M5 产出的 refinement_session + answer 数据。不能并行写 M6 evaluator——会用 mock 数据训练, mock 撕掉时漏洞百出。
- M7 Narrator 依赖 M6 的 gate.passed 事件 + M5 的 raw_text 引用。Narrator 不能在 M6 之前写——它会变成"基于猜测的 prompt"。
- M8 签字依赖 M7 的 commitments.id。签字流程不能在 M7 之前——保护按钮没有它要保护的承诺书。

**唯一允许的"轻并行"**: M5 期间, M6 的规则函数(门 1/门 3 这种纯函数)可以草稿伪代码, 单元测试用 fixture 数据。但**不连接 events / NATS**, 不算"开始"M6。

---

## § 8 · Phase 1 → Phase 2 衔接检查

### 8.1 Phase 1 决策影响 Phase 2 的清单

- **events 表 schema 已锁** (`docs/adr/0002-events-append-only.md`): 我们继续在同一张表 append, 不改 schema, 不加列。Phase 2 的新事件 type 只是在已有列(payload jsonb)里存新结构。**任何想给 events 加列的冲动都拒绝**——加 commitment_id 列? 不, 用 related_thesis (已存在的列) 装 commitment.id。
- **signal.inference_status 枚举 (pending/done/failed)**: Phase 2 的 M6 门 1 厚度判定只看 inference_status = 'done' 的 signal。pending 的不算独立信号。
- **JetStream stream 已存在 `FLASHFI_EVENTS`**: streamSubjects 已经包含 `refinement.>`, `gate.>`, `commitment.>`。Phase 2 不需要新建 stream, 只用 `ensureStream` 的兼容性 update 加新 subjects(如果 Phase 1 的 streamSubjects 列表里少了某个; 但目前已经全, 无需 update)。
- **outbox 模式**: 所有新事件复用 Phase 1 的 outbox worker 路径。新事件只是新 type, payload 落 `event_outbox.payload`, worker 透明地 publish。
- **DevBearer + InternalToken auth**: Phase 2 不引入新 auth。/v1/refinement, /v1/commitments, /v1/gate 全走 DevBearer。/v1/internal/refinement/* 走 InternalToken。
- **Mastra consumer 模式 (`mastra/src/consumers/nats.ts`)**: Phase 2 复制这个 pattern 给 refinement-step / gate-narrow / narrator workflow 各一个 consumer。同一个 stream, 不同 durable name + 不同 SUBJECT。

### 8.2 当前代码里直接可用的占位

- ✅ `server/internal/domain/event.go` 已声明 5 个 Phase 2 EventType (refinement.started / refinement.answered / gate.evaluated / commitment.drafted / commitment.signed)。**M5 实施时这些常量直接 import 即可**, 不需要新声明这 5 个; 但要补声明 4 个辅助事件 (refinement.completed / gate.archived / commitment.postponed / commitment.abandoned)。
- ✅ `server/cmd/api/main.go` 的 streamSubjects 已经包含所有 Phase 2 subjects (signal.> / refinement.> / gate.> / commitment.>)。**M5 实施时不需要改 main.go 的 streamSubjects**。
- ✅ `server/internal/httpapi/router.go` 的 RegisterModules hook 是模块挂载点。M5/M6/M7/M8 各自 module 的 `Handler.Register(publicV1, internalV1)` 直接接到这里。
- ✅ `server/internal/infra/nats/outbox.go` 的 OutboxWorker 透明 publish 所有 type, Phase 2 新事件不需要改它。
- ✅ Mobile `mobile/app/(tabs)/archive.tsx` 当前是 placeholder, M6 改造为 4 池入口。
- ✅ Mobile `mobile/src/shared/components/` 已经有 RomanList / PaperCard / DoubleRule / Masthead / SectionHeader / Display / Serif / Sans / Mono / TapEffect。Phase 2 新增组件直接在这个目录加, 不重新组织。
- ✅ Mobile `mobile/src/core/haptics/index.ts` 已封装 selection / light / medium。**M8 签字直接调 haptic.medium()**。不要装 expo-haptics 之外的库, 不要绕过这个封装。
- ✅ Mobile `mobile/src/core/api/client.ts` 的 ky 实例直接复用。Phase 2 加新 endpoint 在 `mobile/src/core/api/<refinement|commitments|gate>.ts` 各一个文件, 走同一个 api 实例。

### 8.3 Mobile SQLite schema 扩展

Phase 1 末期 mobile 的 pending 队列还在内存 zustand (`mobile/src/features/capture/store.ts`)。M4 task spec 里提到要换 expo-sqlite + Drizzle 但还没装。**Phase 2 第一步 (M5 起步前) 先把这件事完成**:

- 装 `expo-sqlite` + `drizzle-orm`(都不在黑名单, 都是 expo 官方推荐)
- 建 mobile/src/core/db/ 目录, 把 capture pending 队列从 zustand 迁到 SQLite
- 新增 Phase 2 用的本地表:
  - `local_refinement_drafts`: 当前正在答的 session 的草稿答案(用户点了某个选项还没点提交, 切到后台时不丢)
  - `local_commitments_cache`: 承诺书内容 cache (网络断时离线阅读, 但不允许离线签字)
  - `sse_message_log`: SSE 接收过的 question 缓存(重连去重)
- **不**把已签字承诺书 cache 到本地——签字过的 commitment 真相在服务端, 客户端只展示, 不允许本地修改。

**这个迁移属于 M5 起步前的 prep work**, 不算 M5 任务量, 单独算 2 人天(其实可能 1 天就够, 但 zustand → SQLite 总有 edge case)。**计入 W9 D1**(M5 第一天)。

---

## § 9 · 反模式检查清单

下面 10 条对应 `docs/GOAL/AGENT_BRIEF.md` § 9 的"你最容易犯的错"。Phase 2 因为涉及对话 + UI 仪式, 比 Phase 1 更容易踩。每条都要在 PR 自查时勾。

### 9.1 错误清单(每条都要否决一次冲动)

| # | AGENT_BRIEF § 9 错误 | Phase 2 特别容易出现的位置 | 应该的样子 |
|---|---|---|---|
| 1 | 加 Loading Spinner | M5 SSE 等下一题、M7 承诺书生成中、M8 签字到 200 之间 | TypewriterText 或什么都不显示 |
| 2 | 加 Toast | "签字成功"、"草稿已保存"、"四道门全过 🎉" | UI 状态变化直接反馈; 签字后同路由 view 切换 |
| 3 | 用 Material 风格 | 签字按钮变 CupertinoButton 蓝圆角; 选项变 Material RadioButton; ActionSheet 变 BottomSheet | 直角矩形 + Pressable; 自绘 Option 边框; 用 RN 原生 ActionSheetIOS |
| 4 | 加 onboarding | "欢迎开始你的 1 第一次追问!"; 第 1 题前的引导卡 | 直接展示第 1 题; 无欢迎语 |
| 5 | 优化转化漏斗 | "73% 的人在第 3 题放弃, 加个鼓励"; postpone 时催促 | 不分析漏斗; postpone 文案克制("好。我会在明天同一时间再问你一次。") |
| 6 | 写"使用统计"页 | 持仓页上方写"已坚持 89 天 · 你比 80% 的承诺者持续更久"; archive tab 显示"通过率 12%" | 持仓页只写客观信息(签字日期 + 已天数 + 退出条件); archive 不显示通过率 |
| 7 | 把 conviction 改成 flashfi | Narrator agent 的 prompt 里把 "conviction 的本质" 错误改写 | "Conviction Engine"(完整词组) → "Flashfi Engine"; 小写 "conviction"(作为概念)保留 |
| 8 | 看到旧名"Conviction"代码就改 | 承诺书 PDF 页脚的 "Conviction Quarterly" 副线、Masthead 组件的副线 | 保留, 这是品牌设计决策 |
| 9 | 安装 expo-notifications | M6 想给"四道门全过"发推送; M10 (Phase 3) 退出条件触发想发推送 | 永远不装。M6 的全过通过下次打开 APP 时 inbox 顶部展示, 不是 push |
| 10 | 写"未读数" | inbox 顶部"新承诺书 1 份" 红点; archive tab 旁角标 | 没有未读数。已签字的承诺书没有"已读 / 未读"概念 |

### 9.2 Phase 2 模块各自最容易犯的错

**M5 五轮追问 — 写成 wizard 流**:
- ❌ 进度条上方写 "完成 60%! 还剩 2 题"
- ❌ 第 5 题答完弹"恭喜完成训练! 你的认知能力 +20"
- ❌ 每题答完显示"对!" / "错!" 这种判定
- ✅ ProgressDots 静态显示 I-V; 错的轮次给"诊断"(产品语言), 不评判对错; 完成时直接进入下一步

**M6 四道门 — 写成 dashboard**:
- ❌ archive tab 顶部显示 "本月你通过 2 条 / 失败 8 条 / 通过率 20%"
- ❌ 给每个池一个图表 (bar chart 或 pie chart) 显示分布
- ❌ 把四道门可视化成漏斗图
- ❌ 让用户能看到"为什么我的信号在门 2 失败"的详细评分(score 65/100)
- ✅ archive tab 4 个池入口, 每个池显示 "N 条"(纯数字, 不是 %); 进入池里看每条归档时, 显示一句产品语言的归档理由 ("目前只看到 2 条独立信号" 而不是 "g1 thickness count = 2 / required 3")

**M7 承诺书 — 写成 sharing card**:
- ❌ 加 "分享到微信/Twitter" 按钮
- ❌ 加 "导出长图"
- ❌ 加 watermark "Generated by Flashfi"
- ❌ 加风险提示 "本内容不构成投资建议"
- ❌ 加 "查看 AI 推演详情" 折叠面板
- ✅ 承诺书只有 [先放着] + [签字] 两个按钮; PDF 没有水印; 没有任何免责声明; 不展示 "AI" 字眼

**M8 签字 — 写成 onboarding 模式**:
- ❌ 第一次签字时弹"这是你的第 1 份承诺! 让我们了解一下签字仪式的意义..."
- ❌ 签字按钮在用户没滚动到底之前 disabled, 加文字"请先完整阅读"
- ❌ 签字按钮显示倒计时"3 秒后可点击"
- ❌ 签字成功后弹"恭喜! 第 N 份承诺已完成"
- ❌ 签字后引导"现在让我们看看持仓页有什么..."
- ✅ 签字按钮永远可用(没 readiness gate); 按下 mediumImpact 触感; 200 回来同路由 view 切换; 持仓页就是新页面, 不引导

### 9.3 全局自查 grep 命令(PR 前必跑)

在 mobile/ 和 server/ 各跑一遍:

```
# mobile 端
grep -rn "ActivityIndicator" mobile/src mobile/app
grep -rn "Toast" mobile/src mobile/app
grep -rn "Alert.alert" mobile/src mobile/app
grep -rn "Haptics.notificationAsync" mobile/src mobile/app
grep -rn "Material" mobile/src mobile/app
grep -rn "expo-notifications" mobile/package.json
grep -rn "react-native-paper" mobile/package.json
grep -rn "react-native-toast" mobile/package.json
grep -rn "lottie" mobile/package.json

# server 端
grep -rn "wkhtmltopdf" server/
grep -rn "TRUNCATE\|DELETE FROM events\|UPDATE events" server/migrations server/internal
```

**任何一条 grep 出非零结果 = 任务未完成**。

### 9.4 产品语言对照表(Phase 2 专用)

| ❌ 不要 | ✅ 要 |
|---|---|
| 评估完成 | (不显示, 直接进入下一步) |
| 四道门通过 | "我从你最近的几条信号里看到一个可能值得下注的事" |
| 签字成功 | (不显示, view 切换) |
| 提交承诺 | 签字 / 是 |
| 您的承诺书 | 你的承诺书 / 承诺书 · 第 N 份 |
| 推演结果 | 推演 / 一句话总结 |
| 失败 / 错误 | 没过 / 先放着 |
| 加载中 | (不显示) / 准备承诺书… (italic, 不闪) |
| 重试 | 重新签字 |
| 取消 | 再想想 |
| 删除草稿 | 放弃 / 暂时不签 |
| 信号通过率 | (不显示, 不计算) |
| 未读 | (没有这个概念) |

---

## § 10 · Phase 2 完成的"门槛动作"

按 00-overview § "完成的定义" 的 4 个动作, 每一个都是 PR 关门动作:

- [ ] 至少完成 1 次完整的"信号 → 五轮追问 → 四道门 → 承诺书 → 签字"流程
- [ ] 至少出现 3 次"四道门未过 → 沉默归档"(验证沉默机制工作)
- [ ] 签字过的承诺书有 PDF, 内容正确
- [ ] 签字过程符合 native_feel_skill 里所有约束(触感、防双击、报刊感)
- [ ] 整个对话流程, 没有任何 toast / loading / Material Ripple 出现
- [ ] 五轮追问每轮 < 60 秒答完, 不卡

W18 自己用完后, 还要回答 00-overview 的 4 个"过关问题":
1. 五轮追问让我感觉是"在被审问"还是"在和有判断的对手聊"?
2. 四道门把我的信号挡下来时, 我服气还是不服气?
3. 签字那一刻, 我有"这是一份契约"的感觉, 还是"我刚点了一个按钮"?
4. 承诺书 PDF 我会想保存下来吗?

**四问全过 → 进 Phase 3。** 有问不过 → W18 内修对应模块。

---

## 附录 A · 文件树预览

实施完成后, 这些文件会新增 / 改动:

```
server/
├── migrations/
│   ├── 003_create_refinement.up.sql              [新]
│   ├── 003_create_refinement.down.sql            [新]
│   ├── 004_create_gates_commitments.up.sql       [新]
│   ├── 004_create_gates_commitments.down.sql     [新]
│   ├── 005_create_holdings.up.sql                [新]
│   └── 005_create_holdings.down.sql              [新]
├── internal/
│   ├── domain/
│   │   ├── event.go                              [改: 补 4 个辅助 EventType]
│   │   ├── refinement.go                         [新]
│   │   ├── gate.go                               [新]
│   │   └── commitment.go                         [新]
│   ├── module/
│   │   ├── refinement/
│   │   │   ├── handler.go                        [新]
│   │   │   ├── service.go                        [新]
│   │   │   ├── repository.go                     [新]
│   │   │   └── sse.go                            [新]
│   │   ├── gate/
│   │   │   ├── handler.go                        [新]
│   │   │   ├── service.go                        [新]
│   │   │   ├── repository.go                     [新]
│   │   │   ├── gate1_thickness.go                [新]
│   │   │   ├── gate2_consensus.go                [新]
│   │   │   ├── gate3_window.go                   [新]
│   │   │   └── gate4_edge.go                     [新]
│   │   ├── commitment/
│   │   │   ├── handler.go                        [新]
│   │   │   ├── service.go                        [新]
│   │   │   ├── repository.go                     [新]
│   │   │   ├── signing.go                        [新]
│   │   │   └── holding.go                        [新]
│   │   └── pdf/
│   │       ├── renderer.go                       [新]
│   │       └── templates/commitment.html         [新]
│   └── consumers/                                [新目录: gate evaluator internal worker]
│       └── gate_evaluator.go                     [新]
└── cmd/api/main.go                               [改: wire 新模块]

mastra/
├── src/
│   ├── agents/
│   │   ├── socratic.ts                           [新]
│   │   ├── diagnosis.ts                          [新]
│   │   ├── consensus-check.ts                    [新]
│   │   ├── narrator.ts                           [新]
│   │   └── schema.ts                             [改: 新增多个 schema]
│   ├── workflows/
│   │   ├── refinement-step.ts                    [新]
│   │   ├── consensus-evaluate.ts                 [新]
│   │   └── narrator-draft.ts                     [新]
│   └── consumers/
│       ├── nats.ts                               [改: 多 subject consumer 分裂]
│       └── refinement-consumer.ts                [新]
│       └── gate-passed-consumer.ts               [新]
└── tests/
    └── eval/
        ├── socratic/                             [新]
        ├── diagnosis/                            [新]
        ├── consensus/                            [新]
        └── narrator/                             [新]

mobile/
├── app/
│   ├── refinement/
│   │   └── [sessionId]/
│   │       └── index.tsx                         [新]
│   ├── commitment/
│   │   └── [id].tsx                              [新]
│   ├── archive/
│   │   └── [pool].tsx                            [新]
│   └── (tabs)/
│       └── archive.tsx                           [改: 4 池入口]
├── src/
│   ├── core/
│   │   ├── db/                                   [新: SQLite + drizzle]
│   │   └── sse/                                  [新: SSE 客户端封装]
│   ├── shared/components/
│   │   ├── TypewriterText.tsx                    [新]
│   │   ├── GateBar.tsx                           [新]
│   │   ├── SignaturePad.tsx                      [新]
│   │   ├── ProgressDots.tsx                      [新]
│   │   ├── LetterCard.tsx                        [新]
│   │   ├── RefineOption.tsx                      [新]
│   │   ├── CommitmentHeader.tsx                  [新]
│   │   ├── ExitConditionRow.tsx                  [新]
│   │   └── index.ts                              [改: barrel export]
│   └── features/
│       ├── refinement/                           [新]
│       ├── gate/                                 [新]
│       └── commitment/                           [新]

docs/
└── adr/
    ├── 0004-refinement-session-head.md           [新]
    ├── 0005-chromedp-not-wkhtmltopdf.md          [新]
    ├── 0006-sse-streaming-questions.md           [新]
    ├── 0007-gate-engine-deterministic.md         [新]
    ├── 0008-archive-silently.md                  [新]
    ├── 0009-verbatim-quote-rule.md               [新]
    ├── 0010-signing-idempotency-key.md           [新]
    └── 0011-single-active-commitment.md          [新]
```

---

## 附录 B · 一些"我已经想过但不做"的事

下面这些在 Phase 2 设计过程里被考虑过, 决定不做, 列出来防止未来某次 PR 提议:

1. **不做"承诺书 v2 / 修订" 功能** — 签字后不可修改。改 = 写新 commitment, 旧的进 archive。
2. **不做"承诺书模板" 用户可选** — 模板就一个, 报刊风, 不让用户挑。挑剔越多, 仪式感越弱。
3. **不做"签字前预览 PDF"** — 签字前看的就是 RN 渲染的承诺书。PDF 是签字**之后**的归档物。
4. **不做"draft 草稿编辑"** — Narrator 出的草稿不允许用户改字。要改 = 拒签 + 重启追问 + 重新评估。
5. **不做"四道门评估的人工 override"** — 沉默归档不允许"虽然不过但我想签"。这是产品哲学。
6. **不做"多签字"** — 一份承诺只签一次, 不需要 co-sign / re-sign / amendment。
7. **不做"批量归档"** — archive tab 不允许多选 + 删除。归档是 append-only。
8. **不做"承诺书 markdown 导出"** — 只有 PDF 一种格式, 因为 PDF 是物质化的载体。
9. **不做"五轮追问可以跳过某轮"** — 第 5 题不答, refinement 不完成, 不进 gate。
10. **不做"承诺书生成中的进度条"** — 6 秒等待用 TypewriterText "准备承诺书…", 不显示百分比。

---

> 写到这里。任何 AI Agent 拿到这份文档后开始 Phase 2 实施, 请先打开对应 Mn-*.md 任务说明, 这份文档作为施工图查阅。
>
> **不要 over-engineer**。Phase 2 最大的危险不是写不完, 是写过头。
>
> 不确定时, 回到产品哲学: **沉默优于发声**。
