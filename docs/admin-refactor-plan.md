# 后台（web-admin）重构方案

状态：方向已确认（2026-06-15）。本文是实施规格，落地分阶段切片推进。

确认的方向（用户拍板）：
- 范围：**全面运营后台** —— 跨用户全局视图，后端先补齐 `/v1/admin/*` 聚合接口，再做前端。
- 视觉：**顺带做一次视觉刷新** —— 统一品牌头（WiseFlow，替换占位 F logo）、配色与信息密度。

---

## 1. 现状诊断（为什么要重构）

当前 `web-admin/` 是 shadcn SPA（11 项扁平导航），三个核心落差：

1. **它不是真正的后台，是管理员自己 app 数据的网页壳。** 除 `Users`/`Invites` 走 `/v1/admin/*`（真·跨用户），信号/追问/投决/承诺/持仓/复盘全部调用户域 `/v1/*`（SQL `WHERE user_id = $1`）——后台只能看登录管理员自己一个账号的数据。
2. **信息架构停留在已废弃的 M1→M11 里程碑流水线。** 侧栏 hint 直接写 M1/M5/M6/M7-8/M9/M11；Dashboard 文案还是"路线图 Phase 1 · M1→M4"。
3. **缺席当前产品的全部新表面。** 后端已有 订阅/推文(`/v1/subscriptions`,`/v1/tweets`)、项目分类(`/v1/projects`)、降噪(`/v1/distillations`)、统计(`/v1/attention/summary`)、归档分析师对话(`/v1/gate/evaluations/:id/chat`)、伴读(`/v1/commitments/:id/companion`)，后台一个入口都没有。

---

## 2. 目标信息架构（IA）

从"按里程碑"重排为"按运营职责"，分组侧栏：

- **总览** — 仪表盘（系统级 KPI + 研判漏斗 + AI/轮询健康）
- **接入 · 信号** — 订阅源 / 信号流 / 项目分类
- **研判流水线** — 降噪 / 追问 / 投决会 / 承诺·持仓 / 复盘
- **运行观测** — AI 流水线（推断/轮询健康、失败重推） / 指标(Prometheus)
- **管理** — 用户 / 邀请码 / 系统设置

跨页能力：**「聚焦到用户」** —— 用户表点「进入」后，全后台以该用户视角呈现其完整旅程（域页面按 `user_id` 过滤）。

---

## 3. 后端改造（先行）

鉴权骨架复用现成 `adminV1`（`server/internal/httpapi/router.go:78`，Bearer + RequireAdmin）。模块经 `Handler.Register(...)` 注册 admin 路由。

### 3a. 新增聚合模块 `server/internal/module/admin/`（只读、跨表）

- `GET /v1/admin/stats/overview` — 系统 KPI + 研判漏斗（近 30 天）。返回：
  ```
  { users:{total,active_7d,admins},
    signals:{today,total,pending,failed},
    tweets:{today,total},
    subscriptions:{accounts,poller_last_at,poller_errors_24h},
    pipeline:{signals_30d,refine_done,distilled,gate_passed,signed,holdings_active},
    gate_pass_rate_30d }
  ```
- `GET /v1/admin/inference/health` — AI 推断观测：pending/failed 计数、平均时延、最近失败列表（signal_id, user, err, age）。
- `POST /v1/admin/inference/reinfer` — 批量重推失败推断（或复用每信号 reinfer 的 admin 变体）。

### 3b. 各模块新增 admin 跨用户列表端点（复用 repo，去掉 user 过滤 + join users）

- `GET /v1/admin/signals?user_id=&status=&project_id=&q=&limit=&before=` — 跨用户信号（行内带 user email/name）。
- `GET /v1/admin/subscriptions?user_id=` — 跨用户订阅 + 每账号轮询状态。
- `GET /v1/admin/holdings?user_id=&status=` — 跨用户持仓。
- `GET /v1/admin/gate/evaluations?user_id=&passed=&pool=` — 跨用户投决评估。
- `GET /v1/admin/users/:id/overview` — 单用户旅程快照（各域计数 + 最新条目），驱动「聚焦到用户」落地页。
- （phase 2）refinement / distillation / retrospect / commitments 同构补齐。

### 3c. 写/运维操作（phase 3，谨慎）

吊销订阅、强制重推、信号软删（内容治理）等——独立切片，配 `/careful`。

实现要点：每个 admin 列表 = 现有 repo SELECT 的"去 user 过滤 + 加 users join + 可选 user_id 参数"变体；stats = 跨表 COUNT/聚合。机械但需逐条写 SQL + 测。

---

## 4. 前端改造

### 4a. api 客户端（`web-admin/src/lib/api.ts`）
新增 `wiseflow.admin.stats.overview()`、`.inference.health()/.reinfer()`、`.signals.list(params)`、`.subscriptions.list()`、`.holdings.list()`、`.gate.list()`、`.users.overview(id)` + 对应 TS 类型。

### 4b. 路由与页面（`App.tsx` + `pages/`）
按 §2 IA 重排路由。新增页：Subscriptions、Projects、Distillation、AiPipeline。重写为跨用户：Dashboard、Signals、Gate、Positions(Commitments+Holdings)、Refinement、Retrospects、Users(增强)。保留：Metrics、Invites、Settings/System。

### 4c. App 壳 + 视觉刷新
- 重写 `layout/AppShell` + `layout/Sidebar` 为分组导航（section 标签）。
- 视觉系统：品牌头（WiseFlow 字标，替换 F 占位）、配色/密度/统一 PageHeader、表格与状态 pill 规范。沿用 shadcn 基元，收紧 token（`index.css` / `tailwind.config.js`）。
- 「聚焦到用户」：全局 selected-user context + 顶部 banner；置位后域页面带 `user_id` 调 admin 端点。

---

## 5. 实施切片与顺序

1. ✅ 现状勘察 + 可点击原型 + 方向确认。
2. ✅ 本方案文档（preparation）。
3. ✅ 后端切片 1 — `admin` stats 模块（overview + inference health）+ SQL + 测。部署 .205 验证 200。
4. ✅ 后端切片 2 — admin 域列表（signals/subscriptions/holdings/gate + user overview）。部署验证 200。
5. ✅ 前端切片 1 — 新 Sidebar 分组 IA + 视觉刷新（W 品牌头 + 靛蓝主色）+ api client（admin.* 方法/类型）+ 占位页。tsc+vite 构建通过。
6. ✅ 前端切片 2 — Dashboard(系统KPI+研判漏斗) + AiPipeline(/inference) + Users(跨域旅程快照) 接真端点。本地 dev 截图验证真实 .205 数据。
7. ✅ 前端切片 3 — 跨用户域页（Signals/Subscriptions/Holdings/Gate）+「聚焦用户」drill。本地 dev 截图验证（信号 49 行+用户列、聚焦横幅收窄）。
8. ✅ 前端切片 4 — 其余流水线页（Refinement/Distillation/Projects/Retrospects 跨用户 + 聚焦）。后端补 4 个 admin 端点 + 4 页 + 去 sidebar soon。
9. ✅ 部署上线 205:8082 + browse 冒烟（10 页全绿零报错）。注：`make admin-deploy` 内的 npm build 在沙箱 OOM 被 kill（exit137），改用单独 `npm run build` + `rsync dist --no-build` 绕过；nginx 静态服 dist 无需 reload。

---

## 6. 风险与注意

- **后端跑在 .205**（systemd，`./scripts/remote-sync.sh`，非 docker；见 server-deploy-topology 记忆）。每个后端切片需远程构建/重启 + 验证。
- **单用户→跨用户**：去 user 过滤的 SQL 要逐条核对，避免越权/性能（大表加索引/分页）。
- **admin 写操作**谨慎隔离到 phase 3。
- react-doctor：web-admin 现 0 待修，重构勿引回 `useQuery` 反模式（已 filed chip）。
