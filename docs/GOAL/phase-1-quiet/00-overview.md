# Phase 1 · 安静 · Overview

> W1-W8 · 8 周 · 4 个模块 · 1 周自己用

---

## 这一阶段要达成什么

**8 周后, 我能在 iPhone 上做这件事**:

> 每天工作中遇到一个反常的瞬间, 打开 Flashfi APP, 用一句话写进去。
> AI 在后台跑推演, 把它入库到知识图谱。
> APP 大多数时候安静, 不弹任何东西。
> 我能在 A1 收件箱里看到本周记录的列表, 知道 AI 已经跑过了。

**这是 Flashfi Engine 的最基础闭环 ——"信号录入 → AI 推演 → 沉默归档"**。

没有签字, 没有承诺, 没有持仓, 没有复盘。
只有"安静地收下你的观察"。

---

## 不在 Phase 1 范围内的事

- ❌ 五轮追问对话(在 Phase 2)
- ❌ 四道门评估(在 Phase 2)
- ❌ 承诺书 / 签字(在 Phase 2)
- ❌ 持仓 / 退出条件(在 Phase 3)
- ❌ 复盘训练(在 Phase 3)
- ❌ 用户系统 / 登录(只有一个用户:我, 用 hardcoded token 或单用户模式)
- ❌ Android 编译
- ⚠️ TestFlight 内测 — **只允许 W8 "自己用一周" 通过后**, 给少数知情者 (≤ 5 人) 内测,
       不公开邀请码, 不用于验证产品市场契合度, 仅作"是否能在别人手机上跑起来"的工程验证.
       不替代 W8 自己用一周, 不替代 Phase 验收哲学.
- ❌ App Store 公开发布(Phase 4+ 才考虑)

---

## 模块拆解与进度

```
W1 ─┐
W2  ├─ M1 数据底座        ⬜ 未开始
    │   后端 Go 骨架 + Postgres + events 表 + Ent ORM + Docker Compose
    │
W3 ─┤
W4  ├─ M2 信号管道        ⬜ 未开始
    │   signal API + Mastra Analyst Agent + NATS 异步管道
    │
W3 ─┤   并行做(切 context)
W4  │
W5 ─┤
    ├─ M3 客户端外壳      ⬜ 未开始
    │   Expo + 字体 + theme + WatermelonDB + 路由骨架
    │
W6 ─┐
W7  ├─ M4 端到端验证      ⬜ 未开始
    │   B1 录入页 + A1 收件箱 + Sync Queue + 完整链路打通
    │
W8 ──── 自己用一周        ⬜ 未开始
```

每完成一个模块, 把 ⬜ 改成 ✅。

---

## 并行可能性

M1 完成后, M2 和 M3 **可以"假并行"**(同一个人切换 context, 不互相阻塞):

- M2 全在后端 + LLM(Go + Mastra)
- M3 全在客户端(Expo + RN)

它们之间的契约由 **M1 定义的 events 表 schema** + **API 契约文档 04** 兜底, 不会撞车。

M4 是收口模块, **必须串行**, 等 M1+M2+M3 都完成后才开始。

---

## 关键决策已锁定

下面这些决策**在 Phase 1 期间不允许变**:

| 维度 | 选型 | 文档 |
|---|---|---|
| 后端语言 | Go + Gin + Ent ORM | 02 |
| 主数据库 | PostgreSQL 16 + pgvector | 03 |
| 消息总线 | NATS JetStream | 01 |
| LLM 编排 | Mastra (Node.js) | 05 |
| LLM 模型 | Claude Sonnet 4.5(主)+ Haiku(辅) | 05 |
| 客户端框架 | Expo SDK 53+ (Managed) | 06 |
| 客户端语言 | TypeScript | 06 |
| 客户端状态(本地) | Zustand | 06 |
| 客户端状态(服务器) | TanStack Query | 06 |
| 离线数据库 | WatermelonDB | 06 |
| 部署 | Docker Compose, 单 VPS | 07 |

任何 AI Agent 在 Phase 1 期间提议更换上面任一选型, **拒绝**, 引用此节。

---

## Phase 1 的"完成"定义

**不是**全部模块通过测试。

**是**:

W8 那一周, 我在自己的 iPhone 上, 每天打开 APP 写至少 1 条信号, 连续 7 天。
其间:
- ✅ 没有任何 toast / loading / 推送出现
- ✅ 录入流程 30 秒内完成
- ✅ AI 后台推演结果在 30 秒内出现在记录里
- ✅ 离线录入后联网自动同步
- ✅ APP 启动 < 2 秒
- ✅ 没有任何崩溃

如果有任何一项不达标, **Phase 1 不算结束**, 不允许开始 Phase 2。

---

## 风险登记(Phase 1 专属)

| 风险 | 缓解 |
|---|---|
| WatermelonDB 新版本(支持 New Architecture) 不稳定 | 备选: 用 expo-sqlite, 自己包装一层 |
| Mastra 框架不熟悉, 学习曲线陡 | M2 第一周专门做 hello world, 不开发业务 |
| Expo Router 文件路由的边角情况(modal、深链接) | M3 第一周打通最简单的两个页面, 测试模态 |
| Go + chromedp PDF 渲染要等 Phase 2 | Phase 1 不碰这部分, 不浪费时间 |
| 字体加载导致冷启动慢 | 用 expo-splash-screen, 加载完才隐藏 |

---

## 进入下一阶段的"过关"问题

W8 自己用完后, 问自己:

1. 我每天真的打开 APP 写信号了吗? (如果只用了 2 次就开始觉得累 → 录入流程要重做)
2. 录入后我是否信任 AI 在后台跑过推演? (如果不信任 → A1 收件箱呈现要改)
3. 我看到 APP 安静的时候, 是觉得"它在认真工作"还是"它坏了"? (前者过关, 后者要加视觉提示)

这三问全过 → 进 Phase 2。
有一问不过 → 在 W8 内修复, 不延期 Phase 2 的起点(buffer 已留在 Phase 末)。

---

## 给 AI Agent 的话(Phase 1 专用)

Phase 1 看起来"简单", 实际上 **它定义了所有后续 Phase 的数据模型和交互范式**, 这是最关键的 8 周。

容易犯的错:

- 在 M4 着急加 toast 让"看起来流畅"
- 在 M3 用 Material 默认组件"快速搭一下"
- 在 M2 让 LLM 直接输出 JSON, 不做 schema 校验
- 在 M1 跳过 events 表的事件溯源, 直接 CRUD

每一条都会让 Phase 2/3 推不动。**Phase 1 慢一点没关系, 错一点就要重做**。
