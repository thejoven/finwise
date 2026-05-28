# Flashfi Engine · 开发文档

> 一个把模糊的高价值信号,转化为少数高确定性承诺的 AI 产品。
> 这份目录是构建过程中所有技术决策的入口。

---

## 阅读顺序

如果你是第一次进入这套文档,按下面的顺序读:

1. **先读产品文档**(项目根目录的 6 份 md) — 理解产品哲学
2. **再读 01 · 系统架构总览** — 理解技术全景
3. **按需深入** 02-09

每份文档独立成篇,内部交叉引用。任何一份都可以单独喂给 AI 协助开发。

---

## 文档列表

### 核心架构

- **01 · 系统架构总览** — 全局边界,层与层的职责切割
- **02 · Go 服务模块设计** — 后端代码组织,内部接口契约
- **03 · 数据模型与事件溯源** — events 表 + 物化视图,事件类型枚举

### 接口与外部

- **04 · API 契约规范** — REST 接口,SSE 流式,内部 vs 外部边界
- **05 · Mastra Agents & Workflows** — 五个 Agent 的 prompt 设计与工作流编排

### 客户端

- **06 · React Native 应用架构** — Expo Router, 状态管理, offline-first

### 工程与交付

- **07 · 部署与基础设施** — Docker Compose, EAS Build, 可观测性
- **08 · 测试策略** — 判据回归测试, LLM 输出验收, Maestro E2E
- **09 · 开发路线图** — Phase 1→3 的具体里程碑和验收标准

### Agent Skills

- **`/native_feel_skill/SKILL.md`** — 让 RN UI 在 iOS/Android 上像原生, 同时贯彻 Flashfi Engine 的克制哲学
  - `references/01-platform-philosophy.md` — RN 平台心智, 默认 vs 自绘
  - `references/02-ios-checklist.md` — iOS 详细 30 项清单 🟢
  - `references/03-android-checklist.md` — Android 大纲(Phase 2)
  - `references/04-cross-platform-design.md` — 跨平台报刊感设计
  - `references/05-flashfi-restraint.md` — Flashfi Engine 专属克制 🟢
  - `references/06-haptic-grammar.md` — 触感反馈语法
  - `references/07-typography.md` — 字体加载与中文混排
  - `references/08-anti-patterns.md` — 反模式禁止清单 🟢
  - `checklists/new-screen-review.md` — 新页面 30 项自查
  - `checklists/pre-release-audit.md` — 发布前 60 项审计

### 开发目标(给 AI Agent 看的任务单)

- **`GOAL/GOAL.md`** — 主入口, 3 个 Phase × 11 模块, 6 个月路线图 🔴 必读
- **`GOAL/AGENT_BRIEF.md`** — 给 AI Agent 的元指令, 硬约束 + 自由度 + 反模式 🔴 必读
- **`GOAL/phase-1-quiet/`** — Phase 1 · 安静(W1-W8) · 4 个模块
- **`GOAL/phase-2-ritual/`** — Phase 2 · 仪式(W9-W18) · 4 个模块
- **`GOAL/phase-3-mirror/`** — Phase 3 · 镜子(W19-W26) · 3 个模块

---

## 几条贯穿全文档的原则

这几条在每份文档里都会被重复提及,先在这里集中说一次:

**原则 1 · LLM 准备数据 · 规则引擎做判断 · LLM 解释结果**
四道门的判断永远在 Go 里。Mastra 负责"把模糊变结构化"和"把结构化变自然语言",中间的"判断"动作不交给 LLM。

**原则 2 · 事件溯源是事实模型**
`events` 表是 append-only 的事实源。所有其他表都是物化视图,可以重建。任何写入操作都要思考"这是不是一个该被记录的事件"。

**原则 3 · 沉默优于发声**
绝大多数代码路径的终点是"归档"而不是"通知"。每次写一个 if 分支,默认走"沉默"那条。

**原则 4 · 客户端事件 ID 是脊柱**
所有用户行为带一个 `client_event_id` (UUID v7),贯穿 Flutter → Go → Mastra → 回写 Go 的全链路。这是唯一的幂等键。

**原则 5 · 同步与异步边界以"用户是否在等"划分**
用户在屏幕前等的事必须同步且低延迟。用户离开后才发生的事走异步队列。

---

## 技术栈速查

| 层 | 技术 | 用途 |
|---|---|---|
| 客户端框架 | Expo SDK 53+ (React Native) | iOS / Android, 必要时 prebuild |
| 客户端语言 | TypeScript | 强类型, AI 友好 |
| 路由 | Expo Router | file-based, 类型安全 |
| 状态(本地) | Zustand | 简洁, 适合低频交互 |
| 状态(服务器) | TanStack Query | 缓存 + 重试 |
| 离线数据库 | WatermelonDB | offline-first 之王 |
| 触感 | expo-haptics | iOS Taptic Engine |
| SSE | @microsoft/fetch-event-source | 支持 POST + auth |
| 后端语言 | Go | 业务逻辑、判据引擎 |
| Web 框架 | Gin | HTTP / SSE 长连接 |
| ORM | Ent | 强类型, 事件溯源友好 |
| 主数据库 | PostgreSQL + pgvector | 事件流 + 向量检索 |
| 缓存 | Redis | 行为指纹、限流 |
| 消息总线 | NATS JetStream | 事件分发 |
| LLM 框架 | Mastra (Node.js) | Agents & Workflows |
| PDF 渲染 | chromedp (Chromium headless) | 承诺书归档 |

---

## 这套文档的写法约定

**不写假代码**。代码示例都是真实可运行的片段,不是 pseudocode。

**写决策而不只写结论**。每个重要设计后面跟一段"为什么这样,不那样"。

**Phase 1 范围用 🟢 标注**。看到 🟢 表示这部分在 Phase 1 就要做。其他是后续 Phase。

**未决问题用 ⚠️ 标注**。如果某个设计还在讨论中,会显式标出来,不假装已解决。

---

## 版本

`v0.1` · 2026-05 · 初始大纲版本
