# 财富密码 · Progress & Master Roadmap

> 🗄️ **已归档 (2026-06-04)** — 这是一份冻结在 2026-05-25 的快照, 早于 iii 0.16.1、
> ADR 0005(四道门→四位分析师)、四道门改手动触发、项目分组 / 注意力诊断 / 降噪页 / 今日版
> 等一系列变更, 与现状已不符, 仅作历史留存。当前状态请看
> [architecture-iii.html](../architecture-iii.html) 与各模块代码。本文内部链接(GOAL/ 等)
> 因移动到归档目录已失效。
>
> ---
>
> 这份是**操作面板** — 当前在哪一周, 下一步做什么, 风险在哪.
> [GOAL.md](GOAL/GOAL.md) 是**宪法** (产品哲学 + 衡量标准), 这份不替代它.
>
> Updated: 2026-05-25

---

## § 1 · 当前位置

```
代码层 11 个模块全部落地 + Mastra 6 个 Agents 全接 LLM (不是 stub).
剩下: 实机自己用一周 (3 次) + 质量打磨 (eval fixtures / 测试覆盖).

W0  📍 ← 现在 · 全栈代码完成, 等"自己用"验收
W1-W7   M1-M4 Phase 1         ✅  代码 + tsc + go vet 全绿
W8      自己用一周            ⬜  3 端联调 → 7 天每天 1+ 录入
W9-W11  M5 五轮追问           ✅  backend + Mastra Socratic + mobile
W12-W13 M6 四道门             ✅  G1/G3/G4 启发式 · G2 接 Mastra ConsensusCheck (+ 共识指方向 unpriced_directions)
W14-W15 M7 承诺书             ✅  Mastra Narrator + verbatim 校验 + mobile
W16-W17 M8 签字 + 持仓        ✅  幂等 sign + holdings 状态机 + mobile
W18     自己用一周            ⬜
W19-W20 M9 焦虑陪伴           ✅  fingerprint + Mastra Editor (verbatim quote) + mobile
W21-W22 M10 退出巡检 (time)   ✅  cron 1h + state transition + 自动起 retrospect
W23-W25 M11 复盘训练          ✅  4 问 + Mastra Diagnostician + M11.5 闭环
W26     自己用一周            ⬜
        ─── TestFlight 内测 ≤ 5 人 ───
        ─── v1.0 ───
```

每个 ⬜ 必须严格串行 — [GOAL.md § 4](GOAL/GOAL.md) 跨 Phase 不可并发.
代码层完成 ≠ Phase 完成 — Phase 完成靠"自己用一周"验收.

---

## § 2 · 5 月 25 日审计后增量

### 修订决策
- TestFlight 内测**允许** (≤ 5 人, post-W8). [GOAL § 10](GOAL/GOAL.md) + [phase-1-quiet/00-overview.md](GOAL/phase-1-quiet/00-overview.md) 已更新.
- 路径锁定: **自己每天用 + TestFlight 内测**, **不**走 App Store 公开发布.

### M4 critical 代码已补
| 改动 | 文件 | 状态 |
|---|---|---|
| SQLite 持久化 | [storage/db.ts](../mobile/src/core/storage/db.ts) · [pending-signals-repo.ts](../mobile/src/core/storage/pending-signals-repo.ts) | ✅ tsc 通过 |
| netinfo + AppState | [network/netinfo.ts](../mobile/src/core/network/netinfo.ts) · [appstate.ts](../mobile/src/core/network/appstate.ts) | ✅ |
| Sync Queue mutex + 3 attempts + backoff | [store.ts](../mobile/src/features/capture/store.ts) · [PendingFlush.tsx](../mobile/src/features/capture/PendingFlush.tsx) | ✅ |
| 自适应轮询 + focusManager | [hooks.ts](../mobile/src/features/capture/hooks.ts) · [_layout.tsx](../mobile/app/_layout.tsx) | ✅ |
| LLM 自动评分 + few-shot + HTTP 重试 | [analyst.ts](../mastra/src/agents/analyst.ts) · [wiseflow-api.ts](../mastra/src/tools/wiseflow-api.ts) · [eval/run.ts](../mastra/tests/manual-eval/run.ts) | ✅ tsc 通过 |
| Backend 6 个 HTTP 集成测试 | [handler_test.go](../server/internal/module/signal/handler_test.go) | ✅ go vet 通过 |

### 设计已写
- [Phase 2 IMPLEMENTATION_PLAN.md](GOAL/phase-2-ritual/IMPLEMENTATION_PLAN.md) · 1180 行
- [Phase 3 IMPLEMENTATION_PLAN.md](GOAL/phase-3-mirror/IMPLEMENTATION_PLAN.md) · 1469 行
- [TESTFLIGHT_PLAN.md](TESTFLIGHT_PLAN.md) · 部署 + 内测者管理

### 完成度审计
- [audit-phase1-completeness.html](audit-phase1-completeness.html) · 5 月 25 日基线快照

### Phase 2 + Phase 3 实施 (代码层)

| Module | Backend | Mastra | Mobile | 状态 |
|---|---|---|---|---|
| M5 refinement | [refinement/](../server/internal/module/refinement/) | [socratic.ts](../mastra/src/agents/socratic.ts) + [refinement-step.ts](../mastra/src/workflows/refinement-step.ts) | [app/refinement/[sessionId].tsx](../mobile/app/refinement/) | ✅ |
| M6 gate engine | [gate/](../server/internal/module/gate/) (4 道门 + outbox PostPublish 内联评估) | [consensus.ts](../mastra/src/agents/consensus.ts) (G2 真 LLM) | [archive tab](../mobile/app/(tabs)/archive.tsx) (4 池视图) | ✅ |
| M7 commitment | [commitment/](../server/internal/module/commitment/) | [narrator.ts](../mastra/src/agents/narrator.ts) + [commitment-draft.ts](../mastra/src/workflows/commitment-draft.ts) (verbatim 校验) | [app/commitment/[id].tsx](../mobile/app/commitment/) | ✅ |
| M8 signing | (同 commitment 模块) sign / postpone / holdings | — | (同 commitment) sign 按钮 + 持仓状态 | ✅ |
| M9 companion | [companion/](../server/internal/module/companion/) | [editor.ts](../mastra/src/agents/editor.ts) (verbatim quote) | [commitment 页](../mobile/app/commitment/[id].tsx) 内嵌焦虑卡 + POST /open | ✅ |
| M10 exit | [exit/checker.go](../server/internal/module/exit/checker.go) (1h cron, time-only) | — | — (后台自动 transition) | ✅ |
| M11 retrospect | [retrospect/](../server/internal/module/retrospect/) (4 问 + finalize) | [diagnostician.ts](../mastra/src/agents/diagnostician.ts) (focus_dim) | [app/retrospect/[id].tsx](../mobile/app/retrospect/) | ✅ |
| M11.5 闭环 | [user_training_state](../server/migrations/008_retrospects.up.sql) + GET session view 携带 focus | [socratic.ts](../mastra/src/agents/socratic.ts) prompt 注入 | (隐式) 下次 M5 题目变化 | ✅ |
| Mastra HTTP server | — | [server/http.ts](../mastra/src/server/http.ts) (3 endpoints + auth) | — | ✅ |
| Inbox Callouts (M7 草稿卡 / M11 复盘卡) | — | — | [features/inbox/Callouts.tsx](../mobile/src/features/inbox/Callouts.tsx) | ✅ |

### Migrations

- 001 events (M1) · 002 signals + outbox (M2)
- 003 refinement + refinement_questions (M5)
- 004 gate_evaluations + commitments + signed-immutability trigger (M6/M7)
- 005 holdings (M8)
- 006 phase3 partial indexes (M9-M11)
- 007 behavioral_fingerprints (M9)
- 008 retrospects + user_training_state (M11)

---

## § 2.5 · MVP 上线路径 (重要)

代码完成 ≠ MVP 上线. **MVP 上线 = 你自己用得起来 + 不崩 + 体验靠谱**. 因此真正的下一步是 W8.

### 关键决策点

1. **Mastra 6 个 Agent 都接 LLM 了** — Phase 3 v1 的 "stub fallback" 还在保留作为容错, 但默认走 LLM. 跑通需要 `ANTHROPIC_API_KEY` 在 mastra/.env, `MASTRA_HTTP_URL` 在 server .env. 不设 → 自动 fallback 到启发式 (gate G2 给 60/pass, Editor 用 verbatim quote, Diagnostician 用最短答案 dim).

2. **M11.5 闭环已通** — 下一次 M5 五轮追问的 Socratic prompt 自动接最新 training_focus. 复盘训练重点真的会影响下一次出题方向.

3. **Phase 2 的 inbox 触发现在工作** — 当后端有 `status=drafted` 的 commitment, inbox 顶部出现 "AI 给你写了一份承诺书" 卡; 当有 pending/in_progress 复盘, 出现 "持仓到期 · 一起复盘" 卡.

---

## § 3 · 下一步 (按顺序, 不并发)

### Step 1 · 实机验证 M4 (1-2 天)

代码补完不等于完成. 你需要:

1. **本地跑 mobile**: 你的 `expo start` 已在另一 terminal. 改动会 Fast Refresh,
   但首次 SQLite hydrate 需要重启 App (cmd+R in simulator).
2. **联调 backend**: `./scripts/remote-sync.sh` 推到 192.168.1.205, 然后
   `ssh root@192.168.1.205 'cd /opt/wiseflow/server && DATABASE_URL=... go test ./...'`
3. **联调 mastra**: `cd mastra && ANTHROPIC_API_KEY=... npm run eval` 看 ≥7/10 通过
4. **端到端**: 模拟器录一条信号 → 飞行模式 → 录第二条 → 关 App → 重开 → 看 SQLite 队列还在 → 开飞行模式 → 看是否自动同步

如果任何一项不通过, 不进 Step 2.

### Step 2 · W8 自己用一周

按 [phase-1-quiet/00-overview.md](GOAL/phase-1-quiet/00-overview.md) §
"Phase 1 的完成定义":

- 连续 7 天每天 ≥ 1 条录入
- 没崩 / 没出现 toast/loading/push
- 推演 30 秒内回写
- 离线录入自动同步
- 启动 < 2 秒

W8 末三问 (overview § 进入下一阶段的过关问题):
1. 我真的每天打开了吗?
2. 我信任 AI 在后台跑了吗?
3. APP 安静时我觉得它"在工作"还是"坏了"?

三问全过 → Step 3. 否则修 M4.

### Step 3 · TestFlight 内测窗口 1 (1-2 周)

按 [TESTFLIGHT_PLAN.md](TESTFLIGHT_PLAN.md) 走. 重点:

- ≤ 5 个知情者 (事先看过 [产品哲学](产品文档/06_产品哲学.md))
- 反馈只收"工程验证" (能跑/没崩/文案可读), 不收"建议加功能"
- 关闭内测后才进 Phase 2

### Step 4 · Phase 2 M5-M8 (W9-W17)

严格串行: M5 → M6 → M7 → M8. 按 [Phase 2 IMPLEMENTATION_PLAN.md](GOAL/phase-2-ritual/IMPLEMENTATION_PLAN.md)
施工. 每个模块完成时:

- 跑模块自己的 acceptance test
- 不写代码地试用 1-2 次
- 才进下一个模块

### Step 5 · W18 自己用一周 → TestFlight 窗口 2 → Phase 3

同 Step 2-4 模式. Phase 3 按 [Phase 3 IMPLEMENTATION_PLAN.md](GOAL/phase-3-mirror/IMPLEMENTATION_PLAN.md).

### Step 6 · W26 v1.0

终态. 不发 App Store. 关闭 TestFlight (或保留给原内测者).

---

## § 4 · 风险登记 (live)

按风险概率 × 影响 排序. 每个 Phase 启动前重新评估.

| # | 风险 | 概率 | 影响 | 状态 / 缓解 |
|---|---|---|---|---|
| 1 | **自己半年后失去兴趣** | 中 | 致命 | 每个 Phase 末"自己用一周"是续命阀. 不可跳过. |
| 2 | **Narrator 字符级 verbatim 引用失守** | 高 | 高 | Phase 2 风险. 必须在 workflow 层做 substring 校验 + retry + nak 三层兜底. 见 [Phase 2 plan § Narrator](GOAL/phase-2-ritual/IMPLEMENTATION_PLAN.md) |
| 3 | **Diagnostician 输出语义不稳定** | 高 | 高 | Phase 3 风险. M11 已知坑 #1, prompt 至少迭代 10-20 次. 失败 = 财富密码 退回 BI 报告. |
| 4 | **行为指纹假阳性 → 焦虑卡反而制造焦虑** | 中 | 高 | Phase 3 风险. M9 完成后必须 10 天人工标注, 不达标 → 降低触发率而非调阈值. |
| 5 | **训练重点写回闭环漏掉** | 中 | 高 | Phase 3 风险. M11.5 是哲学第 7 条物理实现. 跨 Phase 测试容易跳过. |
| 6 | **SSE 离线恢复复杂度爆炸** | 中 | 中 | Phase 2 风险. M5 五轮中断恢复链路 4 个组件, 估时可能不够. 预留 buffer. |
| 7 | **沉默归档 gate.archived 泄漏** | 低 | 高 | Phase 2 风险. 加 PR 自查 grep 拦截 leak. |
| 8 | **TestFlight 反馈污染产品方向** | 中 | 中 | 按 [GOAL § 10](GOAL/GOAL.md) 修订, 反馈仅工程验证. 内测者必须事先读哲学. |
| 9 | **Mastra 框架成熟度不足** | 中 | 中 | 关键 prompt 抽取为常量, 不深度绑定. |
| 10 | **Expo SDK 升级破坏兼容** | 低 | 中 | 锁版本, 不接 nightly. |

---

## § 5 · 完成度仪表盘 (live)

```
代码层 (3 端 + LLM)                                     ████████████  100%
  Phase 1 · 安静                                        ████████████  100%
  Phase 2 · 仪式                                        ████████████  100%
  Phase 3 · 镜子                                        ████████████  100%
  Mastra 6 个 Agents (Analyst/Socratic/Diagnosis/      ████████████  100%
                     Narrator/Consensus/Editor/Diagnost)
  M11.5 训练重点闭环                                    ████████████  100%

质量层 (eval / 测试 / 监控)                              ████░░░░░░░░  35%
  Phase 1 backend handler 集成测试 (6 个)                ████████████  100%
  Phase 2/3 backend handler 测试                        ░░░░░░░░░░░░    0%  ← 还没写
  Mastra eval fixtures · Analyst (10 条 + 自动评分)     ████████████  100%
  Mastra eval fixtures · Socratic/Narrator/Diagnost     ░░░░░░░░░░░░    0%  ← 还没写
  Backend metrics / observability                       ████░░░░░░░░   30%  ← outbox env 化了, 无指标

验收层 (自己用)                                          ░░░░░░░░░░░░    0%
  Phase 1 W8 自己用一周                                 ⬜  ← 这是真正的 next step
  Phase 2 W18 自己用一周                                ⬜
  Phase 3 W26 自己用一周                                ⬜

部署层 (TestFlight)                                      █░░░░░░░░░░░   10%
  TESTFLIGHT_PLAN.md                                    ✅ 部署清单
  EAS_SETUP.md · eas.json                               ✅
  Apple Developer 注册                                   ⬜  ← 用户做
  EAS Build 跑通 (preview)                              ⬜
  Internal Testers ≤ 5 上线                             ⬜
```

---

## § 6 · 文档地图

```
docs/
├── PROGRESS.md                    ← 你正在看的 (操作面板)
├── README.md                      ← 项目导读
├── audit-phase1-completeness.html ← 5 月 25 日审计快照
├── TESTFLIGHT_PLAN.md             ← 部署 + 内测者管理
│
├── GOAL/
│   ├── GOAL.md                    ← 宪法 (产品哲学 + 衡量标准)
│   ├── AGENT_BRIEF.md             ← 给 AI 的元指令
│   │
│   ├── phase-1-quiet/
│   │   ├── 00-overview.md         ← Phase 1 总览 (含已修订 TestFlight)
│   │   ├── M1-data-foundation.md
│   │   ├── M2-signal-pipeline.md
│   │   ├── M3-client-shell.md
│   │   └── M4-end-to-end.md
│   │
│   ├── phase-2-ritual/
│   │   ├── 00-overview.md
│   │   ├── IMPLEMENTATION_PLAN.md  ← 1180 行施工图
│   │   ├── M5-socratic-refinement.md
│   │   ├── M6-gate-engine.md
│   │   ├── M7-commitment-book.md
│   │   └── M8-signing-flow.md
│   │
│   └── phase-3-mirror/
│       ├── 00-overview.md
│       ├── IMPLEMENTATION_PLAN.md  ← 1469 行施工图
│       ├── M9-anxiety-companion.md
│       ├── M10-exit-monitor.md
│       └── M11-retrospect-training.md
│
├── 产品文档/                       ← 产品定位 + 哲学
├── 技术文档/                       ← 架构 + native_feel_skill
└── adr/                            ← architecture decision records
```

---

## § 7 · 给未来的我自己

如果你 6 个月后翻到这份, 看完面板:

- **没在 W8 用够 7 天** → 不准开 Phase 2 (即使代码都写好了). 回去用.
- **某个 ⬜ 想跳过去** → 翻 [GOAL § 4](GOAL/GOAL.md) 跨 Phase 串行那一节. 没有理由跳.
- **想 "压缩节奏 / 直接 M11"** → 翻这份文档 § 4 风险 #1. 那个风险是致命的, 自己用一周是续命阀.
- **TestFlight 想多邀几个人** → 翻 [GOAL § 10](GOAL/GOAL.md) 修订版. 5 是硬上限.

终点不是 v1.0 落地. 终点是**你打开 iPhone, 它是你的第二大脑**.

如果某天你不再想打开它了, 真正的失败已经发生 — 跟代码进度无关.
