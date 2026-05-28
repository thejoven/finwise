# Phase 3 · 镜子 · IMPLEMENTATION PLAN

> 范围: M9 持仓陪伴 + M10 退出条件巡检 + M11 复盘训练
> W19 – W26 · 8 周 · Flashfi Engine v1.0 的终点
>
> 这份文档是 Phase 3 启动前唯一的"实现合约"。
> 任何写代码动作前, 必须先读完这份。
> 任何与这份冲突的代码, 应被拒收。

---

## § 1 · Phase 3 一句话

**Phase 3 完成时, 我的 iPhone 上有这件事**——

> 我 1 月 22 日签字的一份承诺书已经持仓 30 天。
> 某天股价突然 -5%, 我焦虑地打开 APP 第 3 次。
> APP 没有发任何推送, 没有红点, 没有"风险提示"。
> 它在我**主动打开**承诺页那一刻, 自动把"焦虑日陪伴"这张特殊版面叠上去, 引用我 1 月 22 日**亲手写下的退出条件**, 告诉我这些条件没有一条被今天的波动触发。
>
> 三个月后, 持仓到期。我下次打开 APP, A1 收件箱顶部出现一张"持仓状态变化"卡。我点进去, 进入复盘——一条纵向时间轴铺开这 90 天我跟这件事的所有接触瞬间, AI 问我四个问题, 最后给我一句"下一次, 缩短从信号到签字的天数 3 天"。
>
> 这句话被写进我的用户档案, 改变了下一次 Phase 2 的五轮追问。

**关键: 这不是"通知用户"的产品, 是"用户主动打开时, 镜子已经擦干净挂好"的产品。**

镜子的产品定义:

- 我打开 → 看见我自己
- 我不打开 → APP 安静地待着, 7 天不打开它都不来找我
- 它不评判, 不预测, 不建议——它只**还原**我当时写过的话

如果 Phase 3 完成后, 我对镜子产生了"它在主动管我"的感觉, **Phase 3 没做对**。

---

## § 2 · 数据模型新增

Phase 3 的物理基底沿用 Phase 1/2 的 events 表(append-only, REVOKE)+ outbox 模式。所有派生(commitments、行为指纹、复盘) 都是物化视图, **不直接写状态字段**, 只追加事件后回放。

### 2.1 events 表的 payload schema 新增

所有新事件类型已在 `server/internal/domain/event.go` 占位:

```
companion.shown               (M9)
exit.condition.triggered      (M10)
retrospect.started            (M11)
```

需要追加(写入 `domain/event.go`, 不删旧的):

```
// M9 · 持仓陪伴
EventCommitmentOpened        = "commitment.opened"          // 客户端进入承诺页
EventCompanionShown          = "companion.shown"            // E4 卡渲染给用户
EventCompanionExitInsisted   = "companion.exit_insisted"    // 用户在 E4 上点"我坚持要退出"

// M10 · 退出条件巡检
EventExitConditionChecked    = "exit.condition.checked"     // cron 每次扫描的痕迹
EventExitConditionTriggered  = "exit.condition.triggered"   // 触发了
EventHoldingStateChanged     = "holding.state_changed"      // 持仓状态机迁移

// M11 · 复盘训练
EventRetrospectStarted       = "retrospect.started"
EventRetrospectAnswered      = "retrospect.answered"        // 一道四问被回答
EventRetrospectFinalized     = "retrospect.finalized"       // 训练重点定下
EventTrainingFocusUpdated    = "training.focus.updated"     // 写回用户档案
```

#### payload schemas (Go 端结构体 + Mastra 端 zod, 必须一一对齐)

```
CommitmentOpenedPayload {
  commitment_id: UUID
  user_id:       UUID
  opened_at:     timestamp
  opens_today:   int           // 客户端可选传, 后端权威重算
  origin:        "deeplink" | "tab" | "trigger_card"
}

CompanionShownPayload {
  commitment_id: UUID
  user_id:       UUID
  reason:        "anxiety_3x" | "anxiety_5x" | "manual"
  shown_at:      timestamp
  editor_text:   string        // Editor Agent 生成的主笔按
  editor_model:  string        // 哪个模型, 留作复盘
  fingerprint_id: UUID         // 引用本次焦虑判定的指纹快照
}

CompanionExitInsistedPayload {
  commitment_id: UUID
  insisted_at:   timestamp
  step:          "started" | "questioned" | "confirmed"
  reasons:       string[]      // 用户回答的"为什么要退出"
}

ExitConditionCheckedPayload {
  commitment_id: UUID
  condition_id:  UUID
  evaluator:     "price" | "time" | "fundamental"
  result:        "miss" | "hit"
  observed:      json          // {window_weeks: 2, threshold_pct: 4.1} 等
  checked_at:    timestamp
}

ExitConditionTriggeredPayload {
  commitment_id: UUID
  condition_id:  UUID
  condition_text: string       // 冗余存储, 复盘时用; 因 events append-only
  observed:      json
  triggered_at:  timestamp
}

HoldingStateChangedPayload {
  commitment_id: UUID
  from:          "drafted" | "active" | "triggered" | "expiring"
  to:            "active" | "triggered" | "closed" | "expired" | "abandoned" | "archived"
  trigger_event_id: int64?     // 因哪个事件迁移; 用于事件追溯
  reason:        string        // "user_signed" / "exit_condition_2_triggered" 等枚举
}

RetrospectStartedPayload {
  retrospect_id: UUID
  commitment_id: UUID
  started_at:    timestamp
  trigger:       "expired" | "closed" | "manual"
}

RetrospectAnsweredPayload {
  retrospect_id: UUID
  question_no:   1 | 2 | 3 | 4
  question_dim:  "perception" | "inference" | "evaluation" | "execution"
  choice:        string        // 选项 id
  open_text:     string?       // 开放回答
  answered_at:   timestamp
}

RetrospectFinalizedPayload {
  retrospect_id: UUID
  focus_dim:     "perception_speed" | "inference_depth" | "decision_speed"
               | "holding_patience" | "exit_quality" | "thesis_evolution"
  focus_text:    string        // 30-60 字的具体诊断
  diagnostician_model: string
  finalized_at:  timestamp
}

TrainingFocusUpdatedPayload {
  user_id:       UUID
  retrospect_id: UUID
  focus_dim:     string
  focus_text:    string
  applies_from:  timestamp     // 下一次 Phase 2 启动时从此读
}
```

设计约束(沿用 ADR 0002 append-only):

- payload 写入 events 后 **永远不修改**。
- 派生表(commitments / behavioral_fingerprints / retrospects) **从事件回放**。
- 同一 commitment_id 的 ExitConditionTriggered 事件**幂等**: `(commitment_id, condition_id)` 作为 client_event_id 的命名空间, 重复 cron 不会重复入库。
- companion.shown 不幂等: 一天可以触发多次, 每次都记录, 但**每次只渲染最新**。

### 2.2 是否需要新表?

是, 三张派生表(物化视图风格), 一张行为指纹表。所有派生表都**可以从 events 重建**。

#### 2.2.1 commitments (Phase 2 M8 已建, Phase 3 扩展字段)

Phase 2 M8 应已经建好 `commitments` 与 `holdings` 表(签字流程产物)。Phase 3 假设以下字段已存在, 如果 Phase 2 没建则 Phase 2 必须先补齐:

```
commitments (
  id                 UUID PRIMARY KEY,
  user_id            UUID NOT NULL,
  thesis_id          UUID,                  -- 关联到 M5 五轮追问的 thesis
  ticker             TEXT,                  -- 资产代号 (可为空, mock 也可)
  position_pct       NUMERIC,
  duration_months    INT,                   -- 6, 12, 24 等
  signed_at          TIMESTAMPTZ NOT NULL,
  rationale_text     TEXT NOT NULL,         -- 用户当时签的承诺书原文片段
  exit_conditions    JSONB NOT NULL,        -- [{id, text, type, ...}] 见 § 3.M10
  state              TEXT NOT NULL,         -- 状态机, 见 § 6 ADR-014
  pdf_path           TEXT,                  -- M7 chromedp 生成的 PDF
  created_at, updated_at
)
```

Phase 3 不改这张表的 schema, 只在 `state` 字段上做状态机迁移(由事件回放推动)。**不打开 commitments 表的 UPDATE 权限**——状态机更新走"读旧状态 → 校验合法迁移 → 写 events → 回放更新 state 列"的固定模式。

#### 2.2.2 commitments_active 物化视图 (推荐, 可选)

为了让 cron 巡检快, 加一张物化视图(或 partial index):

```
CREATE INDEX idx_commitments_active ON commitments (user_id, signed_at)
  WHERE state IN ('active', 'triggered');
```

不另开一张表, 用 partial index 即可。`exit_conditions` 已经在 commitments 表里, cron 直接读。

#### 2.2.3 behavioral_fingerprints 表 (M9 持久化层)

行为指纹**短期数据**(24 小时窗口) 在 Redis, **长期数据**写一张表用于复盘:

```
behavioral_fingerprints (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL,
  commitment_id   UUID NOT NULL REFERENCES commitments(id),
  date            DATE NOT NULL,           -- 自然日, 用户时区
  open_count      INT NOT NULL DEFAULT 0,
  open_first_at   TIMESTAMPTZ,
  open_last_at    TIMESTAMPTZ,
  classified      TEXT,                    -- "normal" / "anxious_3x" / "anxious_5x"
  companion_shown BOOLEAN NOT NULL DEFAULT false,
  created_at, updated_at,
  UNIQUE (user_id, commitment_id, date)
)
```

这张表**不是事件**, 是聚合视图——每个 commitment.opened 事件来时, upsert 这张表的当天行(open_count++, 更新 last_at), 同时判断是否需要发 companion.shown 事件。

**为什么不全用 events 计数?** 每天打开 5 次要扫 5 行, 而且 cron 跑 24h 窗口的 group-by 是反 SQL 的。**Redis 做 fast path, Postgres 这张表做 backup + 复盘时间轴源**。每日凌晨一个 daily-flush job 把 Redis 数据写回这张表(防 Redis 重启丢)。

#### 2.2.4 retrospects 表

```
retrospects (
  id              UUID PRIMARY KEY,
  user_id         UUID NOT NULL,
  commitment_id   UUID NOT NULL REFERENCES commitments(id) UNIQUE,
  -- UNIQUE: 一个 commitment 只能复盘 1 次 (M11 已知坑 #5)
  started_at      TIMESTAMPTZ NOT NULL,
  finalized_at    TIMESTAMPTZ,
  state           TEXT NOT NULL,           -- 'pending' | 'in_progress' | 'finalized'
  answers         JSONB NOT NULL DEFAULT '[]',   -- [{q, choice, open_text}]
  focus_dim       TEXT,
  focus_text      TEXT,
  diagnostician_model TEXT
)
```

这张表也是物化视图风格——`retrospect.*` 事件回放即可重建。`UNIQUE(commitment_id)` 物理保证一份持仓只能复盘一次。

#### 2.2.5 users.training_focuses (M11.5)

最近 5 条训练重点写在 users 表的 jsonb 字段(不开新表, 简化):

```
ALTER TABLE users ADD COLUMN training_focuses JSONB NOT NULL DEFAULT '[]';
-- 内容: [{ created_at, retrospect_id, focus_dim, focus_text }, ...] 最近 5 条
```

下一次 Phase 2 M5 五轮追问启动时, `SELECT training_focuses FROM users WHERE id = $1`, 取第一条塞到 prompt。

### 2.3 Migration files needed

按 Phase 3 推进顺序拆 4 个迁移文件, 不堆一个大 migration:

```
server/migrations/
  003_phase3_holdings_state.up.sql       (M9 启动前)
  003_phase3_holdings_state.down.sql
  004_behavioral_fingerprints.up.sql     (M9)
  004_behavioral_fingerprints.down.sql
  005_exit_condition_indexes.up.sql      (M10)
  005_exit_condition_indexes.down.sql
  006_retrospects.up.sql                 (M11)
  006_retrospects.down.sql
```

migration 003 主要做:
- 给 commitments 表加 partial index `idx_commitments_active`
- 给 events 表的 type 列在 `companion.*` / `exit.*` / `retrospect.*` 子集上建 partial index, 加速 M11 时间轴查询
- 给 users 表加 `training_focuses jsonb default '[]'`

migration 004 创建 behavioral_fingerprints 表。

migration 005 给 events 加索引: `(related_thesis, occurred_at)` 已存在, 但 M10 cron 需要快速找"哪些 commitments 还 active", 在 commitments 上加 partial index。

migration 006 创建 retrospects 表 + UNIQUE 约束。

**写法约束**(沿用 ADR 0002): 任何 migration 加表后, **如果该表是只追加的, REVOKE UPDATE/DELETE**。retrospects 是可更新的(answers 累积), 不 REVOKE; commitments 已经在 Phase 2 决定是否 REVOKE(state 列要更新, 通常不 REVOKE 但要在 ADR 里说清)。

### 2.4 物化视图 / 时间窗口聚合策略

#### 24 小时打开次数(M9 fast path)

```
Redis Key: opens:{user_id}:{commitment_id}:{YYYY-MM-DD}
TTL: 48h (留一天 backup 容错)
Op: INCR + GET
```

每日 04:00 UTC 跑 `daily_fingerprint_flush` job, 把昨天的 Redis 计数写到 behavioral_fingerprints 表, 然后 EXPIRE 残留 key。

#### 焦虑判定窗口(后端职责, 客户端不算)

```
当后端收到 POST /v1/commitments/{id}/open 时:
  1. Redis INCR opens 计数
  2. 写 events: commitment.opened
  3. 查询 opens_today
  4. 如果 opens_today >= 3 且 当天还没 companion.shown:
       发起 Editor Agent 调用 (异步), 暂存结果
  5. 返回 { opens_today, should_show_companion: bool }
  6. 客户端拿到 should_show_companion=true → 拉 GET /v1/commitments/{id}/companion 渲染
```

**关键设计点**: 焦虑判定**在后端, 不在客户端**。客户端只是被动渲染——后端说"该显示", 客户端就显示。这避免客户端时间作弊(改本地时钟刷出焦虑卡)。

#### M11 时间轴聚合

```sql
-- 查询某 commitment 的整个时间线
SELECT id, type, occurred_at, payload
FROM events
WHERE user_id = $1
  AND (
    related_thesis = (SELECT thesis_id FROM commitments WHERE id = $2)
    OR payload->>'commitment_id' = $2::text
  )
ORDER BY occurred_at ASC;
```

不做物化视图——一次复盘最多回放几百条事件, 单次查询走索引足够。**不预先汇总, 不预先排序**, 因为时间轴的"节点投影"逻辑在应用层做(每种 type 映射成 timeline node), 提前算反而硬编码了 UI 表达。

---

## § 3 · Go 后端新模块

三个新模块, 模仿 `server/internal/module/signal/` 的三件套(handler.go + service.go + repository.go)。**不打破已有模块边界**, 不修改 signal 模块。

```
server/internal/module/
  signal/                (existing)
  refinement/            (Phase 2 M5)
  gate/                  (Phase 2 M6)
  commitment/            (Phase 2 M7/M8)
  companion/             (Phase 3 M9)   ← new
  exit_monitor/          (Phase 3 M10)  ← new
  retrospect/            (Phase 3 M11)  ← new
```

### 3.1 companion module (M9)

#### HTTP routes

```
POST   /v1/commitments/:id/open              客户端进入承诺页, 上报打开
GET    /v1/commitments/:id/companion         拿当前焦虑陪伴卡内容 (Editor 输出)
POST   /v1/commitments/:id/exit_insist       用户点"我坚持要退出"
GET    /v1/commitments/:id/fingerprint/today 当天打开计数 (debug + UI 用)
```

#### Service responsibilities

```go
// handler.go - 仅做 DTO 转换 + 调 service
// service.go
type Service struct {
  repo        *Repository
  redis       *RedisClient
  mastra      MastraClient    // 调 Editor Agent
  commitments commitment.Reader
}

// 关键方法 (签名级)
func (s *Service) RecordOpen(ctx, userID, commitmentID) (RecordOpenResult, error)
// 返回: opens_today, should_show_companion, companion_payload (如果该显示)

func (s *Service) GetCompanion(ctx, userID, commitmentID) (*Companion, error)
// 返回当前焦虑陪伴卡的全部内容 (包含 Editor 输出的主笔按)

func (s *Service) RecordExitInsist(ctx, userID, commitmentID, step, reasons) error
// 走"我坚持要退出"的三步流程: started → questioned → confirmed
```

#### Editor 调用时机

**RecordOpen** 内部, 当 opens_today 从 2 跨到 3 时(转折点), 异步触发 Editor Agent:

```
go func() {
   editorOut := mastraClient.RunEditor(ctx, EditorInput{
     CommitmentID: id, OpensToday: 3, CurrentPriceMock: mockPrice,
     RationaleText: commitment.RationaleText,
     ExitConditions: commitment.ExitConditions,
   })
   // 写 events: companion.shown(payload=editorOut)
   // 写 outbox: companion.shown
}()
```

GetCompanion 读最新 `companion.shown` 事件返回。**异步生成 + 同步读取**, 因为 LLM 调用慢(5-15s), 不能挡住客户端请求。客户端的处理: 收到 should_show_companion=true 后, 先用占位文本(已写好的中性版本), 后台 poll GET /companion 等 Editor 输出回来再替换。

**为什么不挡住请求等 Editor**: 客户端打开承诺页要立刻显示, 焦虑用户最不能等。占位文本 + 替换的方式让首屏 < 200ms, Editor 慢慢回来。

#### Cron / scheduler

M9 唯一的 cron: **daily_fingerprint_flush**, 每天 UTC 04:00 把昨天的 Redis 计数 dump 到 behavioral_fingerprints 表。简单, 不易出错。

#### NATS subjects

```
publish:
  companion.shown            ← 给 M11 时间轴消费 (Mastra 端不消费, 仅写日志)
  companion.exit_insisted    ← 给 commitment 状态机消费

subscribe: none (M9 是"被客户端调"的, 不是事件驱动)
```

#### 关键风险

1. **行为指纹是否真的能识别"焦虑日"?** 假设"3 次以上 + 当日股价大波动 = 焦虑"——这是**模型层假设**, 可能假阳性(用户只是查信息)也可能假阴性(用户一次性看完不焦虑也不打开)。M9 完成后 W26 自测时, 必须人工标注 10 天的"我自己是否焦虑", 看后端判定准确率。判定不准 → 不是改阈值, 是**降低 companion 卡的显示频次**, 宁愿假阴性(用户错过陪伴) 也不假阳性(在用户不焦虑时跳出来反而像风险提示弹窗)。

2. **Editor LLM 输出不稳定**: 同一份退出条件, 同一个价格波动, LLM 给的"主笔按"可能两次差别巨大。M9 必须 ≥ 10 个 fixture 跑 manual eval, 人工评分。同时 prompt 要严格约束句式(见 § 4.1)。

3. **客户端缓存导致重复打开未上报**: RN 的 navigation 缓存让用户"回退再进"可能不重新 mount——必须在 useFocusEffect 里上报 open, 而不是 useEffect mount。

4. **跨日时间的 Redis Key**: 用户在 23:59 打开一次, 00:01 再开一次, 不该被算作"今天打开 2 次"。Redis Key 用 `YYYY-MM-DD`(用户时区), 跨日自动新 Key, 不会累加。但**时区**: Phase 3 单用户, hardcode Asia/Shanghai 或读 user.timezone。

### 3.2 exit_monitor module (M10)

#### HTTP routes

```
GET    /v1/commitments/:id/exit_conditions   返回当前评估状态
POST   /v1/internal/exit/check               手动触发一次巡检 (dev / test 用)
```

注意: M10 没有"用户主动操作"的 route, 因为它是后台 cron。只暴露**只读 + 内部触发**两个口子。

#### Service responsibilities

```go
type Service struct {
  repo        *Repository
  priceFeed   PriceMockProvider     // Phase 3 用 mock
  newsFeed    FundamentalProvider   // 简化: 检测"最近有财报"
  mastra      MastraClient          // 基本面用 LLM (可选)
  commitments commitment.Reader
}

func (s *Service) CheckAll(ctx) (CheckResult, error)
// 遍历所有 ACTIVE 持仓, 评估每条退出条件

func (s *Service) EvaluateCondition(ctx, holding, cond) (Evaluation, error)
// 单条评估, 内部分发到 evaluatePrice / evaluateTime / evaluateFundamental
```

Type 1 (price)、Type 2 (time)、Type 3 (fundamental) 三种评估器**分文件**, 每个独立测试。fundamental 是唯一需要调 LLM 的, 其它纯算。

#### Cron / scheduler 设计

```go
// server/cmd/api/main.go 启动时:
cronCtx, cancel := context.WithCancel(ctx)
exitChecker := exitmod.NewChecker(repo, priceFeed, mastra)

cron.Schedule("0 */4 * * *", exitChecker.Run)  // 每 4 小时
// 用 robfig/cron/v3

// 失败仅写日志 (zap), 不报警 (报警发给运维 = 我自己, 后续再加)
```

**为什么 cron 不用流式监听价格变化?** 见 ADR-009。简单总结: Phase 3 价格是 mock, 不接真实行情, "流式"没东西流。

**幂等**: `events.client_event_id` 用 `(exit_condition_check, commitment_id, condition_id, YYYYMMDDHH)` 的 UUID v5, 保证同一窗口重复 cron 跑只产生一次 triggered 事件。

#### NATS subjects

```
publish:
  exit.condition.checked     ← 每次扫描的痕迹 (可选, 调试)
  exit.condition.triggered   ← 真正触发了
  holding.state_changed      ← 状态机迁移到 TRIGGERED

subscribe:
  commitment.signed          ← 签字事件 → 开始监控这个新持仓
                              (其实 cron 每次会重扫, 这个订阅可选)
```

#### 关键风险

1. **退出条件 trigger 是否会误报?** Phase 3 价格是 mock, mock 数据可以构造任意触发场景, 但**真实场景**(Phase 4 接行情) 容易频繁触发——比如"连续 4 周下跌 10%" 在波动市里随便就满足。Phase 3 必须把每次触发的 observed 数据完整记下来, W26 自测时人工 review 5 个触发用例, 看是否符合"严肃退出条件"。**误报的代价**: A1 收件箱出现"持仓状态变化"卡, 用户进入持仓页发现没事, 这是产品哲学层面的"狼来了"——一次都不该发生。

2. **fundamental 评估的 LLM 不稳定**: "公司毛利率下季度下滑" 让 LLM 判断, 同样输入两次, 一次返回 hit 一次返回 miss——产品就乱了。M10 设计上 LLM 仅做"事件检测"(最近有没有财报), 不做"判断毛利率好坏"。判断逻辑在规则引擎里。

3. **cron 漏跑**: 服务重启时 cron 重新注册, 但已经过去的 trigger 窗口可能被跳过。**M10 不需要补跑**——退出条件评估是当下状态, 不是历史回放, 4 小时后下一次再跑就行。

4. **TRIGGERED 后用户没打开**: § 1 已说"7 天没打开不主动联系", 这是产品哲学底线。code 里**绝对不能写**"如果 7 天没看就 push 一次"这种代码——审查每个 PR 时盯这一条。

### 3.3 retrospect module (M11)

#### HTTP routes

```
POST   /v1/commitments/:id/retrospect/start          开启复盘
GET    /v1/retrospects/:id                           读复盘状态
GET    /v1/retrospects/:id/timeline                  时间轴节点
POST   /v1/retrospects/:id/answer                    答一道四问
POST   /v1/retrospects/:id/finalize                  四问全答 → 调 Diagnostician
GET    /v1/retrospects/:id/focus                     拿到训练重点
```

#### Service responsibilities

```go
type Service struct {
  repo            *Repository
  eventReader     event.Reader       // 读 events 重建时间轴
  commitments     commitment.Reader
  fingerprints    companion.Reader   // 读焦虑日
  mastra          MastraClient       // 调 Diagnostician
  userRepo        UserRepo           // 写 training_focuses
}

func (s *Service) Start(ctx, userID, commitmentID) (*Retrospect, error)
// 校验 commitment 状态是 EXPIRED/CLOSED, 创建 retrospect, 写 retrospect.started

func (s *Service) BuildTimeline(ctx, retrospectID) ([]TimelineNode, error)
// SELECT events WHERE related_thesis = thesis_id, 投影成 TimelineNode

func (s *Service) Answer(ctx, retrospectID, questionNo, choice, openText) error
// 累积到 retrospects.answers, 写 retrospect.answered

func (s *Service) Finalize(ctx, retrospectID) (*Focus, error)
// 调 Diagnostician → 拿 focus_text → 写 retrospect.finalized + training.focus.updated
// 更新 users.training_focuses (push 到队首, 保留最近 5 条)
```

#### Cron / scheduler

M11 唯一的 cron: **expiry_check**, 每天 UTC 04:00 扫一遍 ACTIVE 持仓, 把到期(`signed_at + duration_months <= now`) 的状态机迁移到 EXPIRED, 并写 holding.state_changed 事件。

不在 EXPIRED 时自动开启复盘——**等用户主动打开**。开启复盘的入口是用户进入持仓页, 看到"这次持仓已到期, 一起复盘 →"。

#### NATS subjects

```
publish:
  retrospect.started
  retrospect.answered
  retrospect.finalized
  training.focus.updated

subscribe:
  holding.state_changed (where to=EXPIRED or to=CLOSED)
    ← 不是为了开复盘, 是为了写一条"复盘待机"事件, 用于 A1 收件箱提示
```

#### 关键风险

1. **Diagnostician prompt 质量**: M11 已知坑 #1——"prompt 至少迭代 10 次, 用 5+ 个 fixture 复盘测试"。M11 完成的硬条件是: **同一组事件 + 同一组四问回答, Diagnostician 输出语义稳定**(不会一次说"练第二阶推演", 下次说"练耐心")。这是 Phase 3 最难的工程任务。

2. **时间轴节点选择主观**: 哪些 events 上时间轴, 哪些不上? § 1 决策: 只有"用户接触瞬间"上(签字、想反悔、复盘)和"对用户重要的客观事件"上(财报、到期)。**signal.inference.done 不上**——AI 后台的事不是用户接触。**companion.shown 上** 但显示成"焦虑日 △"——是用户的接触, 不是 AI 的动作。

3. **训练重点写回是闭环, 易漏**: M11.5 (training_focus 影响下次 M5) 是产品哲学第 7 条的物理实现。这条**最难验收**, 因为要再走一次 Phase 2 才能看到效果。W26 自测时必须有一次"复盘 → 重启 Phase 2 → 验证 M5 prompt 加入了 focus_text" 的端到端测。

4. **答完四问的 LLM 调用如果失败**: Diagnostician 是关键链路, 失败要怎样? **不可降级**——不发"祝你好运" 这种 fallback 文案。失败就报错, 让用户重试(界面上显示"系统在想, 请稍后")。不能把不可靠的输出当成"看见自己"的素材。

---

## § 4 · Mastra Agents 新增

新增两个 Agent, 一个非 Agent 的"评估调用"。模仿 `mastra/src/agents/analyst.ts` 的写法: prompt 写在文件里, instructions 用 backtick 多行, 严格 zod schema, 一次 retry。

```
mastra/src/agents/
  analyst.ts         (Phase 1, existing)
  socratic.ts        (Phase 2 M5)
  narrator.ts        (Phase 2 M7)
  editor.ts          ← Phase 3 M9 (new)
  diagnostician.ts   ← Phase 3 M11 (new)
  schema.ts          ← 扩展 EditorOutputSchema + DiagnosticianOutputSchema

mastra/src/workflows/
  signal-inference.ts        (Phase 1, existing)
  editor-companion.ts        ← M9 (new)
  exit-fundamental-check.ts  ← M10 (new) — 非 Agent, 是 LLM tool 调用
  retrospect-diagnose.ts     ← M11 (new)

mastra/src/consumers/
  nats.ts                    ← 扩展订阅 commitment.opened 和 retrospect.finalize_requested
```

### 4.1 Editor Agent (焦虑日陪伴)

**任务**: 拿到 commitment + 当前股价 + 当前打开次数, 写一段 50-100 字 "主笔按" , 引用用户当初签字时写的退出条件 + 当时签字的"理由原文"。

#### 输入 schema

```ts
const EditorInputSchema = z.object({
  commitment_id: z.string().uuid(),
  ticker: z.string(),
  days_held: z.number().int(),
  rationale_text: z.string().min(20),        // 用户原话
  exit_conditions: z.array(z.object({
    id: z.string(),
    text: z.string(),                        // 原文
    type: z.enum(['price', 'time', 'fundamental']),
    observed: z.string(),                    // 当前观察值 "0/4 周"
    triggered: z.boolean(),
  })),
  opens_today: z.number().int(),
  current_price_mock: z.number(),
  price_change_pct: z.number(),              // "−4.2%"
  recent_news_summary: z.string().optional(),// "1 篇大 V 文章看空 X" mock
});
```

#### 输出 schema

```ts
const EditorOutputSchema = z.object({
  editor_text: z.string().min(50).max(120),  // 字数硬限制
  quotes_from_user: z.array(z.string()).min(1).max(2),  // 必须至少引用一处用户原话
  cited_exit_conditions: z.array(z.string()).min(1),     // 至少引用一条退出条件 id
});
```

输出**必须**满足:
- 引用至少一条用户当初写的退出条件(by id)
- 引用至少一句用户原话(quotes_from_user 非空)
- 不预测股价, 不评论市场
- 字数 50-120

zod 在 max 120 上做硬截, LLM 超了 → 一次 retry, 再超抛错。

#### Prompt 草稿

```
你是 Flashfi Engine 的 Editor (主笔)。

你不是分析师, 不是顾问, 不是助手。
你是一位严肃报刊的主笔, 接到了一份你自己 [days_held] 天前签字的承诺书,
现在用户焦虑地第 [opens_today] 次打开了这份承诺书。

你的任务: 写一段 50-100 字的"主笔按", 帮用户想起当初的判断。

严格约束:
- 不预测股价
- 不评论市场("市场可能...")
- 不给建议("建议继续持有")
- 不用 "AI 分析师认为" 等措辞
- 不用 emoji, 不用感叹号
- 字数 50-100, 不超过 3 句
- 必须引用用户当初签字时的某句原话 (rationale_text 里抽)
- 必须明确说出"哪条退出条件触发 / 没触发"
- 语气: 像一位严肃报刊的主笔的按语, 平静、克制、有判断
- 必须使用第二人称 "你", 不能用 "用户" 或 "他"

正确示例:
"今天的价格波动不触发你 1 月 22 日签字的任何退出条件。那篇大 V 文章不在你的判据里。
你当时写的'HBM 周期才走到 1/3', 今天没有反例。"

错误示例 (你写出来就 retry):
"建议继续持有, 市场短期波动属于正常现象。" (违反: 给建议 + 预测)
"AI 分析师认为这次回调是机会。" (违反: 自我标签 + 暗示买入)
"亲, 别慌, 你做得很好!" (违反: 语气, 不是主笔风格)

输出 JSON, 字段: editor_text, quotes_from_user, cited_exit_conditions。
不要 Markdown 包裹, 不要前后解释。
```

#### fixture 数量与评分标准

- ≥ 10 个 fixture (10 个不同 commitment + 不同价格波动场景)
- 评分维度(每条 1-5 分):
  1. 是否引用用户原话(是否抓住关键词)
  2. 是否明确列出退出条件状态
  3. 字数是否合规
  4. 语气是否"主笔感"(无建议 / 无预测 / 无 emoji)
  5. 是否能让用户"想起当初"
- 平均 ≥ 4.2 分通过, 否则改 prompt 重跑

### 4.2 Exit Monitor (不是 Agent, 是 cron + 选择性 LLM)

**M10 大部分不需要 LLM**:
- Type 1 价格类: mock 数据 + 规则, 0 LLM 调用
- Type 2 时间类: 纯算时间差, 0 LLM 调用
- Type 3 基本面: **仅在用户的退出条件文本里有"财报"/"毛利率"/"营收"等关键词时**, 才调一次 LLM, 用 web search 工具检测"最近 30 天有没有这家公司的新财报发布"

```ts
// mastra/src/workflows/exit-fundamental-check.ts
export async function checkFundamental(input: {
  ticker: string;
  condition_text: string;        // "公司毛利率下季度下滑"
}): Promise<{ event_detected: boolean; evidence: string }> {
  // Phase 3: 不真做 web search, mock 返回 { event_detected: false } 或测试时构造 true
  // Phase 4 可接 Anthropic web search tool
}
```

**何时调 LLM, 何时不调**:
- cron 每 4 小时跑一次, 默认**不调 LLM**(只跑 type=price / type=time)
- 仅对 type=fundamental 的条件, 每天**最多一次**调 LLM(用 events 表查最近 24h 有没有同 condition 的 check 记录, 有就 skip)
- 这是为了控成本——Phase 3 是单用户, 但 fundamental check 每天最多 N(持仓数) 次 LLM 调用, N <= 3

### 4.3 Diagnostician Agent (复盘训练)

**任务**: 看用户的四问回答 + 完整时间轴, 给一句 30-60 字的"下一次训练重点"。

#### 输入 schema

```ts
const DiagnosticianInputSchema = z.object({
  commitment_id: z.string().uuid(),
  ticker: z.string(),
  days_held: z.number().int(),
  return_pct: z.number(),                    // 模拟收益, mock 也行
  trigger_reason: z.string(),                // 怎么结束的: "exit_condition_2" / "expired" / "user_closed"

  timeline_summary: z.object({
    days_signal_to_sign: z.number().int(),   // 从最早信号到签字几天
    anxiety_days: z.number().int(),          // 焦虑日次数
    exit_insist_count: z.number().int(),     // "我坚持要退出" 次数
    earnings_validated: z.boolean(),         // 是否有财报印证
  }),

  answers: z.array(z.object({
    question_no: z.number().int().min(1).max(4),
    question_dim: z.enum(['perception', 'inference', 'evaluation', 'execution']),
    choice: z.string(),
    open_text: z.string().optional(),
  })).length(4),
});
```

#### 输出 schema

```ts
const DiagnosticianOutputSchema = z.object({
  focus_dim: z.enum([
    'perception_speed', 'inference_depth', 'decision_speed',
    'holding_patience', 'exit_quality', 'thesis_evolution'
  ]),
  focus_text: z.string().min(30).max(60),    // 字数硬限制
  must_contain_number: z.boolean(),          // 内容里是否包含具体数字
  // schema 用 refine 强制 focus_text 里包含一个数字 (正则 /\d+/)
});
```

#### Prompt 草稿

```
你是 Flashfi Engine 的 Diagnostician (诊断员)。

你看了用户这次承诺书的完整经历——从早期信号到签字, 中间焦虑了 [anxiety_days] 天,
持仓 [days_held] 天, 通过 [trigger_reason] 结束, 收益 [return_pct]%。
你看了用户对四问的回答。

你的唯一任务: 写一句 30-60 字的"下一次训练重点"。

严格约束:
- 必须包含一个具体数字(从输入数据里取)
- 必须指向 6 个维度中的一个(见 focus_dim)
- 不允许出现以下空话:
  * "继续努力"
  * "保持信心"
  * "你做得很好"
  * "下一次会更好"
  * "相信自己"
  * "市场会回报"
- 必须是行动指引("下一次, 缩短 X"), 不是评判
- 字数 30-60, 中文标点不算

6 个维度的解释:
- perception_speed:  从最早信号到记录的延迟
- inference_depth:   一阶/二阶/三阶推演的层数
- decision_speed:    从信号到签字的天数
- holding_patience:  焦虑日占比 / 想反悔次数
- exit_quality:      退出条件是价格类还是认知失效类
- thesis_evolution:  这次新出现的判据 / 修正的判据

正确示例:
"下一次, 缩短从信号到签字的天数, 这次你用了 14 天, 收益区间已过去 60%。"
"下一次, 在退出条件里加'认知失效'类条件, 这次你的 3 条退出全部是价格类。"
"下一次, 重点练第二阶推演, 这次三道追问你都停在了'谁直接受益', 没问'谁因此被打击'。"

错误示例:
"下一次保持耐心, 相信自己的判断。" (空话 + 没数字)
"你这次做得不错, 继续努力!" (空话 + 评判而非行动)

输出 JSON: { focus_dim, focus_text, must_contain_number }。
不要 Markdown 包裹。
```

#### fixture 数量与评分标准

- ≥ 5 个 fixture(M11 已知坑 #1 要求 ≥ 5)
- 评分维度:
  1. 是否包含具体数字
  2. 是否指向一个 focus_dim
  3. 字数合规
  4. 是否有"看见自己"的震撼感(主观打分, 我自己评)
  5. 同 fixture 跑 5 次的输出一致性(同 focus_dim, 文字相近)
- 平均 ≥ 4.5 分通过(标准比 Editor 高, 因为这是产品终点)
- **如果 5 次跑出 3 个不同 focus_dim, prompt 重写**

#### Mastra Workflow 拼装

```
mastra/src/workflows/retrospect-diagnose.ts:

export async function runDiagnose(input: DiagnosticianInput): Promise<DiagnosticianOutput> {
  // 1. 跑 diagnostician (with retry, like analyst.ts)
  // 2. 把结果 POST 回 Go: /v1/internal/retrospects/{id}/focus
  // 3. 返回结果给调用方 (NATS 消费者 或 直接 HTTP 触发)
}
```

调用方式两种:
- **同步**: Go 的 retrospect.Finalize 直接 HTTP 调 mastra 的内部 endpoint(类似现在 analyst 的 internal/inferences 反向)。**首选**, 因为复盘是用户在等。
- **异步备份**: 失败时落 NATS, 后台重试。

---

## § 5 · Mobile UI 新增

新增 4 个 RN 路由 + 1 个时间轴组件 + 1 个触发卡组件。沿用 mobile/src/shared/components 风格(Display/Serif/Sans/Mono、报刊感、theme.color)。

```
mobile/app/
  (tabs)/
    inbox.tsx                       (existing, 改: 加 triggered-card 插槽)
  signal/[id].tsx                   (existing)
  commitment/
    [id].tsx                        ← 持仓页 (Phase 2 M8 已建, M9 加 companion 触发)
    [id]/companion.tsx              ← E4 焦虑陪伴页 (M9)
    [id]/exit_insist.tsx            ← "我坚持要退出" 流程 (M9)
    [id]/retrospect.tsx             ← 复盘对话页 (M11)
    [id]/retrospect/final.tsx       ← 复盘结束页 (M11)

mobile/src/features/
  capture/                          (existing)
  commitment/                       (Phase 2)
  companion/                        ← M9 (new)
    AnxietyBanner.tsx               ← E4 顶部的"焦虑日 · 系统识别"块
    EditorByline.tsx                ← 主笔按 (黑底白字)
    OpensCount.tsx                  ← "你今天打开第 N 次" 大字组件
    useCompanionState.ts            ← hook: 查后端 should_show + poll editor
    ExitInsistFlow.tsx              ← 三步质询流程
  exit_monitor/                     ← M10 (new)
    TriggeredCard.tsx               ← A1 收件箱顶部触发卡
    ConditionRow.tsx                ← 持仓页中带"已触发"标记的条件行
    useTriggeredInbox.ts            ← hook: 拉 triggered 持仓列表
  retrospect/                       ← M11 (new)
    Timeline.tsx                    ← 自绘纵向时间轴
    TimelineNode.tsx                ← 单节点(支持 6 种类型)
    QuestionCard.tsx                ← 四问对话卡(复用 M5 风格)
    FocusByline.tsx                 ← 训练重点(黑底白字)
    useRetrospect.ts                ← hook
```

### 5.1 持仓陪伴页 / E4 焦虑陪伴 (M9)

**触发逻辑** (在持仓页, 不是新路由):

```ts
// app/commitment/[id].tsx (持仓页) — Phase 2 M8 已建, Phase 3 加这段
useFocusEffect(() => {
  // 1. 每次进入这页就 POST /v1/commitments/{id}/open
  // 2. 拿到 response.should_show_companion
  // 3. true → router.push(`/commitment/${id}/companion`)
  //    false → 正常持仓页
});
```

**E4 页布局** (`app/commitment/[id]/companion.tsx`)严格按 M9 spec 的 ASCII 图:

```
顶部: SECTION D · 持仓陪伴 · 第 N 天
块 1: ◆ 焦虑日 · 系统识别 (Display + Serif italic)
       "你今天打开这个 APP 第 N 次"
块 2: ◆ 今日检测 · 数据视角 (Mono 数据行)
块 3: ◆ 你 X 月 X 日签字的退出条件触发了几条?
       三条 RomanList, 每条带 observed 状态
块 4: ◆ 主笔按 · 今天的波动 (黑底白字, EditorByline 组件)
       Editor Agent 输出
底部: [看完了, 关闭] [查看完整时间轴 (Phase 3 M11)]
       我坚持要退出  ← link 样式, theme.color.muted, 不是按钮
```

**视觉硬约束**:
- 没有 banner, 没有红色, 没有图标系统
- "焦虑日 · 系统识别" 的"系统识别" 用 muted 小字, 不强调
- 主笔按用 `theme.color.ink` 底 + `theme.color.paper` 字, 直角, 无阴影
- 没有 Loading Spinner: Editor 没回来时显示**占位文本**(预先准备好的中性文)
- 不触感反馈(用户在焦虑, 不刺激)

**反例(不做)**:
- 任何 "⚠️" 图标
- "建议持有" 或 "建议退出" 按钮
- 当前股价的 K 线图
- "已识别您处于焦虑状态" toast

### 5.2 退出条件触发提示 (M10)

**A1 收件箱顶部触发卡** (`features/exit_monitor/TriggeredCard.tsx`):

布局: 在 `app/(tabs)/inbox.tsx` 的 ListHeaderComponent 里加一段, 拉 `useTriggeredInbox()` 看有没有 TRIGGERED 持仓。

```
┌──────────────────────────────────┐
│  ◆ 持仓状态变化                  │  ← Display 14, Display.italic
│                                  │
│  SK 海力士                       │  ← Display 18
│  退出条件 II 已触发:             │  ← Serif italic 12, muted
│  公司毛利率下季度下滑            │  ← Serif 13
│                                  │
│  [查看持仓 →]                    │  ← link 样式, 不是按钮
└──────────────────────────────────┘
```

**视觉硬约束**:
- 不闪烁(没有 Animated.loop)
- 不出现 badge / 红点
- 不弹 modal
- "查看持仓 →" 是 Pressable 但视觉是文字+箭头, 不是矩形按钮
- 排序: 在 Masthead 下方、SilenceStamp 上方, **不抢眼**
- 多个 triggered 持仓: 罗列(I, II, III), 不省略

**用户点进持仓页后** (`app/commitment/[id].tsx`):
- 触发的退出条件行加灰底高亮 + ✓ 标记
- 状态: "1/3 触发" 文字, 不是进度条
- 底部 link: "重新评估这次持仓 →" 跳到 M11 的复盘流程(或简化版决策)

### 5.3 复盘对话页 (M11)

**入口**: 持仓状态为 EXPIRED 或 CLOSED 时, 持仓页底部出现 "一起复盘 →" link。点击 POST start 后 router.push 到 `/commitment/[id]/retrospect`。

**复盘页布局**:

上半部分: 时间轴(Timeline 组件), 占视口 50-60%, 可滚动。
下半部分: QuestionCard, 一次显示一道四问, 答完点"继续下一问 II / IV"。

**时间轴自绘** (`features/retrospect/Timeline.tsx`):

按 M11 spec 的代码草稿实现, 三列布局: 日期 | 竖线+节点 | 内容。

```
节点类型 → 形状映射:
  signal       → 白圆 (中空, ink2 描边)
  gate_passed  → 实心方 (ink)
  sign         → 红星 (theme.color.red, ★ 字符)
  anxiety      → 三角警告色 (△, theme.color.warning - 新加 token)
  fundamental  → 绿圆 (theme.color.green - 新加 token)
  end          → 黑星 (★)
```

**theme 扩展**: 在 `mobile/src/core/theme/colors.ts` 加两个 token:
```
warning: '#A0703C'  (低饱和度的警告色, 避免亮黄)
green:   '#3A6B4F'  (低饱和度的暗绿)
```

不引入第三方 timeline 库——M11 spec 明确禁。

**QuestionCard** 复用 M5 五轮追问的卡片样式(M5 应已建)。每道四问一张卡, 答完滚到下一道。完成 4 道 → 自动 POST finalize → 跳 final.tsx。

### 5.4 复盘结束页 (`app/commitment/[id]/retrospect/final.tsx`)

按 M11 spec 的 ASCII 图实现:

```
F2 · 复盘结束
SK 海力士 · 持仓 137 天 · 收益 +18.7% · 触发 退出条件 II

──────────────────

◆ 这次, 你看见了什么
• 早期信号识别能力强(1 月 8 日)
• 四道门评估扎实, 没有冲动签字
• 持仓中焦虑 3 次, 都没割肉

──────────────────

◆ 下一次训练重点
(Display italic, 大字)

"下一次, 缩短从信号到签字的天数,
 这次你用了 14 天, 收益区间已过去 60%。"

— Flashfi 主笔 (FocusByline 黑底白字组件)

──────────────────

[归档这次承诺书 →]
```

点击 "归档这次承诺书 →" 写 holding.state_changed (to=ARCHIVED), 跳回 inbox。

### 5.5 反例: 这些 UI 元素 Phase 3 一概不做

| 不做的东西 | 哪条产品哲学/反模式 |
|---|---|
| "今日盈亏" 数字 | M9 反模式: 不显示股价/盈亏 |
| 持仓股价 K 线图 | M9/M11 反模式: 违反"细节里有真相", 用户进焦虑 |
| 账户净值卡 | 全 Phase: Flashfi 不是 trading platform |
| "本月复盘 3 次" 统计 | § 2.2: 不显示使用统计 |
| "持仓胜率 80%" 等指标 | M11 反模式 |
| 分享按钮 / 邀请按钮 | § 2.2 + M11 反模式 |
| "已成功签字!" toast | § 2.1 + M8 反模式 |
| Loading Spinner | § 2.1 一律不显示 |
| "持仓状态变化" red banner | M10 反模式: 不闪烁不抢眼 |
| App icon badge | § 2.1 |
| Push 通知 / 权限弹窗 | § 2.1 + M10 反模式 |

---

## § 6 · 关键 ADR (新增 7 条)

新建文件: `docs/adr/0009-...md` ~ `docs/adr/0015-...md`。每条独立 markdown, 沿用 0001-0003 的格式(上下文 / 决策 / 为什么 / 后果 / 复盘条件)。

### ADR-009 · 退出条件巡检用 cron, 不用流式监听

**决策**: M10 用 `robfig/cron/v3` 跑定时任务(每 4 小时), 不订阅 NATS 的 "price.tick" 流。

**为什么**:
- Phase 3 价格数据是 mock, 没有真实流可监听。
- 真接行情 (Phase 4+) 时, 流式监听的过滤逻辑等同于 "if 触发就 emit", cron 实现同样可行但简单 10 倍。
- 退出条件本身是"窗口性"的(连续 4 周下跌 10%), 自然适合 cron 周期性窗口计算, 不适合 tick-by-tick 评估。
- cron 4 小时一次符合产品哲学"沉默"——不必实时反应市场波动。

**复盘条件**: 真接行情后, 出现"用户已经看到价格暴跌, 但我们的 cron 还没跑 → 触发延迟 4 小时"成为投诉, 重新考虑流式。

### ADR-010 · 复盘用四问, 不用五问 / 三问 / 自由对话

**决策**: M11 的复盘对话固定为 4 个问题, 对应感知/推演/评估/执行 四层认知。不允许加第 5 问, 不允许减到 3 问, 不允许做"自由提问"模式。

**为什么**:
- 4 问对应产品哲学 5 个层的前 4 层(第 5 层就是复盘本身, 不是问题)。
- 5 问会让用户产生"应试感", 4 问刚好是"诊断"。
- 自由提问会让 LLM 变成 chatbot, 打破产品哲学的"严肃契约"。
- 4 问的总时长 ≤ 5 分钟, 用户能在一次 session 走完。

**复盘条件**: W26 自测时, 发现某一问"信息量太低"(选项答案没影响 Diagnostician 输出), 删掉那一问, 改成 3 问。**不允许加问。**

### ADR-011 · 焦虑日识别用"打开频次 + 后端判定", 不用 LLM 实时判断

**决策**: M9 的焦虑判定是后端规则: opens_today >= 3 且 (price_change_pct < -3% 或 has_recent_anti_news)。不调 LLM 来"判断用户是不是在焦虑"。

**为什么**:
- 行为指纹是**可证伪的客观信号**(次数 + 时间 + 价格), 不是主观判断。
- 用 LLM 判断会带来不稳定性(同样输入, 一次说焦虑一次说不焦虑)。
- LLM 调用慢 + 贵, 不适合"用户打开 APP 这一帧"做。
- 隐私: 不把"用户的浏览行为"送给 LLM 来评判, 是 § 9 反模式之一。

**Editor Agent 仍调 LLM**——但它在已判定为焦虑后才被调, 输出"主笔按"内容, 不输出"是不是焦虑"的判定。

**复盘条件**: 假阳性多(我自己标 10 天发现 > 30% 被误判焦虑), 不改阈值, **改为降低 companion 触发率**(改成 >= 5x 才触发, 而不是 3x)。

### ADR-012 · 行为指纹存 Redis (短期) + Postgres (长期), 不全用 events 表

**决策**: 当日打开计数走 Redis(24h TTL); 每天 04:00 一个 daily-flush job 把昨天的计数写到 behavioral_fingerprints 表; commitment.opened 事件每次仍写 events 表(为复盘时间轴, 但只取节点不计数)。

**为什么**:
- events 表是 append-only, 计数当日打开次数要 `SELECT count(*) WHERE type='commitment.opened' AND user=$1 AND occurred_at > today_start()` , 每次打开都跑这个 SQL = 反 SQL 设计。
- Redis INCR/GET 是 O(1)。
- behavioral_fingerprints 表是聚合视图, 用 UNIQUE(user, commitment, date) 保证幂等; 重启 Redis 不丢历史。
- 时间轴只需要节点("这天是焦虑日"), 不需要"打开第几次"——event count 已经在 fingerprint 表里。

**复盘条件**: Redis 不再可用 → 把 fingerprint 表的 upsert 直接做在 HTTP handler 里(每次 commitment.opened 同步 upsert)。性能差但 Phase 3 单用户能接受。

### ADR-013 · M10 退出条件评估的三类型分流

**决策**: 退出条件分 3 类(price / time / fundamental), 每类用不同评估器。**fundamental 是唯一调 LLM 的**, 且每天最多一次。

**为什么**:
- price (mock) 和 time 是纯算, 不该让 LLM 判断"4 周回落 10% 算不算触发"——这是 LLM 不该决定的事。
- fundamental ("公司毛利率下季度下滑") 必须 LLM 因为是自然语言, 但 LLM 仅做"事件检测"(财报有没有发布), 不做"判断毛利率好坏"。
- 三类分流让 99% 的 cron 跑零 LLM 调用, 成本可控。

**复盘条件**: 用户写出非 3 类的退出条件(如"管理层换人"), 加第 4 类 evaluator, 不允许把它塞进 fundamental 让 LLM 兜底。

### ADR-014 · 持仓状态机的严格定义

**决策**: 持仓只有 7 个状态, 状态机迁移由事件驱动, 不允许"跳跃"或"回退"。

```
DRAFTED       (M7 承诺书草稿)
  ↓ commitment.signed
ACTIVE        (Phase 3 大多数时间在这)
  ↓ exit.condition.triggered (>=1 条) → TRIGGERED
  ↓ 持仓到期 cron → EXPIRED
  ↓ 用户在 ExitInsist flow 确认 → CLOSED

TRIGGERED → (用户在持仓页确认接受触发) → CLOSED
EXPIRED   → (用户开复盘 + 复盘完成 + 归档) → ARCHIVED
CLOSED    → (用户开复盘 + 复盘完成 + 归档) → ARCHIVED

DRAFTED → (postpone x3 by Phase 2 M8) → ABANDONED  (终态)
```

7 个状态: DRAFTED / ACTIVE / TRIGGERED / CLOSED / EXPIRED / ABANDONED / ARCHIVED。

**为什么**:
- 状态机是 product behavior 的根, 任何"漏状态"或"非法迁移"都会让派生失真。
- ABANDONED ≠ CLOSED: ABANDONED 是"签字前放弃", CLOSED 是"签字后关闭"。复盘只对签字过的(ACTIVE/CLOSED/TRIGGERED/EXPIRED) 开。
- ARCHIVED 是终态——归档后用户可查, 但不出现在主流程。
- 每次迁移**必须**写 holding.state_changed 事件, 含 from/to/reason, 复盘时间轴用得上。

**实施**: 在 `commitment` 模块里 (Phase 2) 加 `StateMachine` 类型, 把所有合法迁移 (from, to) -> reason 列举, 任何非法迁移直接 reject。

**复盘条件**: Phase 4 加"分仓"/"多持仓并行", 状态机会更复杂, 那时重写。

### ADR-015 · Diagnostician 输出必须包含数字, 必须指向 6 个 focus_dim 之一

**决策**: M11 的 Diagnostician zod schema 用 refine 强制 focus_text 必须包含 `/\d+/` 数字, 且 focus_dim 必须是 6 个枚举之一。不允许"我觉得这次没太大问题, 继续保持就好"这种输出。

**为什么**:
- 产品哲学第 7 条"教练角色, 越用越强" 要求训练重点是**可执行 + 可衡量**。
- 没有数字的输出 = 没法量化下一次进步("下一次缩短从信号到签字 3 天" vs "下一次缩短一些天数")。
- 6 个 focus_dim 是已确定的认知维度, LLM 不能瞎发明新维度。
- schema 验证失败 → retry 一次, 再失败抛错, 让用户看到"系统在想"(界面而非 toast 提示), 不发 fallback 文案。

**复盘条件**: 6 个维度不够覆盖某次复盘(出现"想加第 7 个"), 不偷偷加 fallback, **把第 7 个写进 schema 和 prompt**, 并更新 ADR。

---

## § 7 · 顺序与时间估算

按 GOAL.md § 4 严格串行 (M9 → M10 → M11), 但 M9 与 M10 可并行(00-overview.md § 4 已说), M11 必须等两者。

```
W19 ─┬─ M9 持仓陪伴 E4
     │   后端: companion module + Redis 接入 + Editor Agent + behavioral_fingerprints 表
W20 ─┘  前端: AnxietyBanner + EditorByline + 焦虑触发逻辑 + ExitInsist 三步

W21 ─┬─ M10 退出条件巡检
     │   后端: exit_monitor module + cron + 3 类评估器
W22 ─┘  前端: TriggeredCard + 持仓页 ConditionRow 高亮 + A1 inbox 改造

W23 ─┐
W24  ├─ M11 复盘训练
     │   后端: retrospect module + Diagnostician + training_focus 写回
W25 ─┘  前端: Timeline + QuestionCard + final.tsx

W26 ── 自己用一周
       完整跑通信号 → 签字 → 焦虑 → 触发 → 复盘 → 训练重点 → 再签
```

### 时间分配(每周 ≈ 25 工程小时)

| 模块 | 后端 | Mastra | 前端 | 测试 + eval | 总计 |
|---|---|---|---|---|---|
| M9 (2 周) | 18h | 12h | 14h | 6h | 50h |
| M10 (2 周) | 22h | 6h | 10h | 12h | 50h |
| M11 (3 周) | 22h | 18h | 22h | 13h | 75h |
| W26 自测 | — | — | — | 25h (完整闭环 + 修小问题) | 25h |
| **小计** | 62h | 36h | 46h | 56h | **200h** |

**最大不确定性**: Diagnostician prompt 迭代次数(M11 已知坑 #1 说 10 次), 实际可能 15-20 次, 每次跑 5 fixture × 5 次 = 25 个 LLM 调用 + 人工评分, 单次 1-2h。M11 的 13h 测试时间是下限, 上限可能到 25h。

### 串行边界

- **M9 完成的硬条件**: E4 卡至少触发 1 次 + Editor Agent fixture eval 平均 ≥ 4.2 分 + "我坚持要退出" 三步走通。
- **M10 完成的硬条件**: cron 跑 1 周不挂 + 至少 1 次 triggered (用 mock 数据手动构造) + 触发幂等(同一窗口跑 5 次只写 1 个 event)。
- **M11 开始的前置**: M9 + M10 都完成, 且行为指纹表有至少 30 天数据(可以从 W19 就开始打开承诺页攒数据)。

### W26 自测的产品级 5 件事

1. 完整跑一次完整周期(可用 mock 时间快进 90 天)
2. 至少触发 1 次 E4 焦虑卡 + 1 次退出条件
3. 完成 1 次完整复盘对话(4 道题答完, Diagnostician 给出训练重点)
4. 把训练重点写入用户档案, 重启 Phase 2 M5 验证 prompt 加入了 focus_text
5. 问自己 "Flashfi 突然消失我会失去什么"——答 "看见自己的能力" → 产品成立

---

## § 8 · Phase 2 → Phase 3 衔接检查

Phase 3 的所有模块都假设 Phase 2 完成了**特定的数据和契约**。这一节是 Phase 2 进 Phase 3 前必须确认的清单。

### 8.1 Phase 2 必须完成的硬清单

- [ ] commitments 表存在, 含 `state` 字段, 至少支持 DRAFTED → ACTIVE / ABANDONED
- [ ] holdings 概念已经在 commitments 上的 state 字段实现(不是另开一张 holdings 表; ADR-014 说明持仓即承诺书的执行态)
- [ ] commitment.signed 事件 schema 含 `exit_conditions` 数组(每条带 id + text + type)
- [ ] M7 的 Narrator Agent 把自由文本退出条件**已经解析成结构化**(type=price/time/fundamental + 阈值字段)
- [ ] PDF 归档已落 chromedp, 但 PDF 存储路径在 commitments.pdf_path 字段
- [ ] M8 的 "先放着, 明天再决定" 流程已实现 `commitment.postponed` 事件
- [ ] 持仓页路由 `/commitment/[id]` 已存在, Phase 3 在它上面加 companion / retrospect 子路由

### 8.2 Phase 2 决策对 Phase 3 的约束

| Phase 2 决策 | 对 Phase 3 的影响 |
|---|---|
| events append-only (ADR-002) | M9/M10/M11 都不允许更新 events, 状态机走"读 + 写新事件" |
| commitments.exit_conditions 是 JSONB | M10 cron 直接 JSON 解析, 不用 join 表 |
| Mastra Agents 走 instructions 写死在文件 (ADR-003) | Editor/Diagnostician prompt 在 mastra/src/agents/*.ts, 不在配置 |
| 黑名单依赖列表 (AGENT_BRIEF § 2.4) | Phase 3 不能装 react-native-timeline-flatlist, M11 时间轴自绘 |
| 触感只暴露 selection/light/medium | E4 焦虑页不加触感(M9 已知坑 #5), 不需要 heavy |
| outbox 模式 | Phase 3 所有事件发布走 outbox, 不直接调 NATS publish |
| commitments.state 列可更新 | 注意: REVOKE 没开, Phase 3 的状态机更新通过 ENT 走, 但要在 ADR-014 里说清"通过 service 层封装, 不允许直接 SQL update" |

### 8.3 如果 Phase 2 没完成全部, 怎么办?

按依赖关系:
- **M9 可以在没有真签字的情况下做** (用 mock 持仓), 但 M9 完成验收必须有真签字
- **M10 必须等 M8 完成** (cron 扫的是 commitments 表, 没数据扫不了)
- **M11 必须等 M9 + M10 + 1 个完整周期**

**最坏路径**: 如果 Phase 2 在 W18 没完成, Phase 3 不能启动。绝不"先做 Phase 3, Phase 2 边做边补"——产品语言 / 数据模型会乱。

---

## § 9 · Phase 3 专属反模式

针对 Phase 3 容易犯的错。每一条都是"看到就拒绝", 不留商量空间。

### 9.1 把"持仓陪伴"做成股票 APP 的持仓页

**反例**: 顶部大字 +18.7%, 下面 K 线图, 再下面财经新闻流, 旁边一个 BUY/SELL 按钮。

**为什么禁**: Flashfi Engine **不是** trading platform。M9 spec 明确写:
> ❌ 不要展示股价 K 线图(违反"细节里有真相")

正确形态: E4 是**主笔的按语版面**, 主体是用户当初的判断 + 当下的客观事实(没触发的退出条件)。

**code 层物理保证**: `app/commitment/[id]/companion.tsx` 不允许 import 任何 charting 库(victory-native / react-native-svg-charts 等), 不允许显示 priceCurrentValue 这类时序数据。

### 9.2 把"退出巡检"做成 push 通知

**反例**: M10 触发后调 `expo-notifications.scheduleNotificationAsync` 推一条"你的持仓 X 已触发退出条件, 点击查看!"

**为什么禁**:
- AGENT_BRIEF § 2.4 黑名单: `expo-notifications` 永远不装
- AGENT_BRIEF § 2.1: 不发推送
- 产品哲学: 7 天不打开 APP 都不主动联系

**code 层物理保证**: package.json 不出现 expo-notifications。CI 加 grep `expo-notifications` 失败 build。

### 9.3 把"复盘训练"做成"使用统计页"

**反例**: M11 final.tsx 顶部 "本季度复盘 3 次, 平均收益 +12%, 胜率 67%", 中间柱状图。

**为什么禁**:
- AGENT_BRIEF § 2.2: 不显示"使用统计"
- M11 反模式: "不显示胜率、年化收益率等量化指标"
- 产品哲学: 训练重点是诊断, 不是炫耀

**正确替代**: 复盘结束页只有一句训练重点 + 三句"这次你看见了什么"。**不出现任何排行/统计/对比**。

### 9.4 把"行为指纹"做成"用户画像"

**反例**: 后端攒"你这个月每天平均打开 N 次", 给用户看 "你是高度焦虑型投资者" 标签。

**为什么禁**:
- 行为指纹是**判定信号**(用来决定是否显示陪伴卡), 不是给用户看的 profile
- "投资者类型" 标签是 § 2.2 的"使用统计" 变种
- 隐私: 用户的浏览行为不应该被 LLM 评判后给用户看
- 产品哲学: 镜子, 不是教练——AI 不该贴标签

**code 层物理保证**:
- behavioral_fingerprints 表**没有面向用户的查询接口**, 只有后端读
- 任何 "anxiety_type" / "user_type" / "profile" 命名的字段一概拒绝
- companion.shown 事件里**不存储**"你是什么类型的人"——只存"今天你打开 N 次, 显示 X 卡"

### 9.5 把"训练重点"做成"自我提升 tips"

**反例**: Diagnostician 输出 "今天的你比昨天更好了! 加油!" / "记得保持心态平和"。

**为什么禁**:
- M11 spec 已经禁了空话
- ADR-015 已经强制 focus_text 必须含数字 + 指向 focus_dim

**code 层物理保证**:
- zod schema 用 `.refine((s) => /\d/.test(s), '必须含数字')` 强制
- LLM 输出违反 schema → retry, 再违反抛错
- prompt 里硬列错误示例, 让模型避免

### 9.6 把"时间轴"做成"持仓走势图"

**反例**: M11 的 Timeline 上面叠加股价线, 让节点对应价格点。

**为什么禁**:
- M11 spec: "时间轴像电影时间线, 不是 K 线图"
- "主角是用户的接触瞬间, 不是市场事件"

**code 层物理保证**:
- Timeline 组件的 props 只接受 `TimelineNode[]`, **没有** priceCurve / chartData
- 渲染层不允许 import 任何图表库

### 9.7 把"我坚持要退出" 做成一键退出按钮

**反例**: 在 E4 焦虑页放一个红色 "Sell Now" 按钮, 点了直接关持仓。

**为什么禁**:
- M9 spec: "我坚持要退出" 必须走重新评估流程
- 产品哲学第 4 条 (耐心的工程化): 让用户慢下来

**正确实现**: 点击后走 3 步质询(为什么要退 / 这条理由是否在当初的退出条件里 / 确认), 3 步全过才真正 CLOSED。

### 9.8 把"复盘对话"做成 chatbot

**反例**: M11 用一个 ChatScreen 组件 + 流式 SSE, 用户和 AI 你一句我一句。

**为什么禁**:
- M11 反模式: "不要复盘对话用 chatbot 形态"
- chatbot 打破"严肃契约"的氛围

**正确实现**: 一次一张卡(QuestionCard), 4 道题, 中间无 chat 历史。题目和选项**预先生成好**, 不是 AI 实时聊。

### 9.9 给焦虑用户做"安抚动画"

**反例**: E4 卡显示时缓缓淡入 + 心跳动画 + 配上低沉音乐。

**为什么禁**:
- AGENT_BRIEF § 2.1: 不震动反馈, 不音效
- M9 已知坑 #5: 用户在焦虑, 不刺激

**code 层物理保证**: E4 页**没有** Animated, 没有 Reanimated 入场动画, 没有 Audio。直接显示即可。

### 9.10 用 expo-notifications 让 M10 在退出条件触发时弹通知

已在 9.2 提过, 但因为这是 Phase 3 最容易"想加"的功能, 单列再强调一次:

**永远不装 expo-notifications**。一旦看到 PR 里加它, 拒绝合并, 哪怕用任何理由。

---

## § 10 · "镜子"哲学的工程落地

Phase 3 的产品哲学核心是 **"镜子, 不是教练"**——给用户的是用户当时自己写的话, 不是 AI 的判断。

这一节回答: 这句口号怎么在每个模块的**代码层物理保证**?

### 10.1 镜子原则 1 · 用户看到的是自己, 不是 AI

#### M9 的物理保证

- E4 焦虑陪伴页的**主体**(占视口 70%) 是用户当初写的退出条件 + 当初签字的 rationale 原文。
- Editor Agent 输出的"主笔按"占视口 < 25%, 且**必须引用至少一句用户原话**(zod schema `quotes_from_user.min(1)` 物理强制)。
- 主笔按下方署名是 "AI 主笔 · 引自你的承诺书"——明确说明这是 AI 整理用户原话, 不是 AI 的判断。

**code 模式**:
```
EditorAgent input: { rationale_text, exit_conditions, ... }
EditorAgent output: { editor_text, quotes_from_user: [...必须非空], cited_exit_conditions: [...必须非空] }
                                    ↑
                                    schema refine 强制, 不引用就抛错 retry
```

#### M11 的物理保证

- 时间轴每个节点的**内容**(title / subtitle) 都从 events 表里取**用户行为或客观事实**, 不允许是 AI 生成的描述。
  - signal 节点: `payload.raw_text` (用户自己写的)
  - sign 节点: `payload.rationale_text` 摘录
  - anxiety 节点: "今天打开 N 次"(客观)
  - earnings 节点: "X 公司发布 Q3 财报"(客观, mock 在 Phase 3)

- 训练重点写完后, 用户看到的是**一段引语风格**: "下一次, 缩短从信号到签字的天数, 这次你用了 14 天"——主语是"你"和"这次", 不是 "我们的 AI 建议你"。

**code 层断言**: 在 Timeline 组件的 TimelineNode.tsx 里**禁止** `node.aiDescription` 这类字段。每个节点的 title/subtitle 必须能追溯到 events 表的真实 payload。

### 10.2 镜子原则 2 · APP 不主动找用户, 用户主动找它

#### M9 的物理保证

- E4 焦虑陪伴卡**只在用户主动打开承诺页时**才有机会显示。
- 后端的 `RecordOpen` 是被客户端调用才执行, 不是后台主动推。
- 没有任何 cron 在用户没打开的时候发起"提醒"。

#### M10 的物理保证

- 退出条件触发后**不发推送, 不发邮件, 不发短信**。
- 触发结果只在 A1 收件箱顶部的"触发卡"里——用户**主动打开 inbox 才能看到**。
- 触发后 7 天用户没打开 APP, **不做任何额外动作**(产品哲学底线)。

**code 层断言**:
- package.json 不含 expo-notifications / @react-native-firebase/messaging 等推送相关库
- server 端没有任何 SMTP / 短信 / push provider 集成
- exit_monitor cron 完成后**仅写 events + outbox**, 不调任何"通知发送" 接口

#### M11 的物理保证

- 持仓 EXPIRED 后**不自动开复盘**。
- 用户进入持仓页看到 "一起复盘 →" link, 点了才开。
- 复盘启动的入口是 `POST /v1/commitments/:id/retrospect/start`, 来自客户端。

### 10.3 镜子原则 3 · 不评判, 不预测, 不建议

#### Editor Agent (M9) 的物理保证

- prompt 明确列出"不要的措辞": "建议持有", "AI 分析师认为", "市场可能", "你做得很好"
- prompt 列正反例, 让 LLM 学到边界
- 输出 zod 不容许 max 120 字超出——超了 retry, 再超抛错(不允许"AI 多写一段建议")

#### Diagnostician Agent (M11) 的物理保证

- prompt 强制"必须包含具体数字"(ADR-015)
- prompt 严禁"继续努力" / "保持信心" 等空话
- focus_dim 必须是 6 个枚举之一, LLM 不能瞎发明新维度
- schema refine: `must_contain_number` 检查必须为 true, 否则 retry

#### M10 的物理保证

- 退出条件评估只输出 hit/miss + observed 数据
- **不输出**"你应该退出" / "建议关注" 等指向行动的话
- A1 触发卡的文案是"持仓状态变化", 不是"建议立即处理"

### 10.4 镜子原则 4 · 用户的判断是主角, AI 是助手

#### M9 / M11 的视觉物理保证

- 主笔按和训练重点都用**黑底白字小块**, 视觉上是"框住的"——明确是引用, 不是主体
- 用户原话用 Display 18-22, 主笔按用 Serif 13——字号层级让用户原话占主导
- 时间轴节点排序按时间, 不按"AI 重要度"——AI 不挑哪些节点更重要

### 10.5 镜子原则 5 · 行为指纹是判定信号, 不是用户画像

#### M9 的代码层保证

- behavioral_fingerprints 表**没有面向用户的 GET 接口**。`GET /v1/commitments/:id/fingerprint/today` 只返回 `opens_today` 数字, **不返回**"你今天属于焦虑型"等标签。
- companion.shown 事件 payload 里**不存储**用户画像字段(没有 `user_personality`, `user_anxiety_score` 等)。
- Mastra 端的 Editor Agent **不接收** "用户是什么类型" 的输入, 只接收"这次的具体数据"。

### 10.6 镜子原则 6 · 训练重点写回是闭环, AI 通过用户的弱点变得"懂你"

这是产品哲学第 7 条的物理实现, 也是 M11.5 的核心。

#### M11 的代码层保证

- Diagnostician 输出后**必须**写 `training.focus.updated` 事件 + 更新 users.training_focuses
- 下次 Phase 2 M5 五轮追问启动时, **必须**从 users.training_focuses 读最近一条, 塞到 socratic Agent 的 prompt
- 这条链路要有**端到端测试**: fixture 1 个复盘 → Diagnostician 输出 → 重启 M5 → 看 prompt 是否含 focus_text

**code 模式** (M5 端, Phase 2 已实现, M11.5 接口):
```
mastra/src/agents/socratic.ts (假设 M5 已建)
  constructor(latestFocus?: { focus_dim, focus_text }) {
    instructions = baseInstructions + (latestFocus
      ? `\n\n用户上一次复盘的训练重点是: ${latestFocus.focus_text}\n这次五轮追问中至少两题围绕 ${latestFocus.focus_dim}。`
      : '')
  }
```

### 10.7 一句话总结

> **镜子的工程化 = 让每一个输出层物理上无法变成"AI 的判断"。**
>
> 不是靠 prompt 自律, 不是靠 review 把关——是靠 zod schema、视觉层级、数据库字段命名、API 设计——**多重物理约束**让 AI 即使想做"教练"也做不出来。

每一条镜子原则都要有"如果代码这样写, 物理上做不到反模式"的保证。审 Phase 3 PR 时, 不光看测试通过, 还看**这条原则在代码里的物理保证体现在哪一行**——找不到行 = PR 不能合。

---

## 文档结束语

这份 IMPLEMENTATION_PLAN 是 Phase 3 启动前的合约。

它不是建议, 是边界。它列出的反模式不接受讨价还价。

如果 Phase 3 开发过程中, 出现 "这个约束实际做起来太死, 能不能松一下" 的冲动——**不要松, 写 ADR 改这份文档**, 让人类(项目所有者)决定。

不要静默偏离。

写完 Phase 3 后, W26 自测那一周, 我会问自己一句话:

> 如果今天 Flashfi Engine 突然消失, 我会感到失去了什么?

如果答案是 "失去了我看见自己的能力"——产品成立, Flashfi Engine v1.0 完成。
如果答案是 "失去了一个 AI 工具"——产品没成立, 退回找出在哪一步把镜子做成了工具。
