# 归档 · Archive

> 这里存放**跟不上更新速度、与现状不符**的历史文档——冻结在某个时间点的快照、
> 已被架构演进取代的分析、以及已解决的问题记录。
>
> 它们**不删除**(保留决策与演进的痕迹), 但已移出活跃文档路径, 避免误读为当前事实。
>
> 归档日期: **2026-06-04**

---

## 为什么归档这些

仓库在 2026-05-28 首次提交后的一周内连续发生几轮架构级变更:

- **2026-05-29** — iii 引擎升级到 0.16.1(console 崩溃修复)
- **2026-05-30** — [ADR 0005](../adr/0005-analysts-over-gates.md):"四道门"→"四位分析师", 四道判断全部改由 LLM(Mastra)裁决
- **四道门改手动触发** — `POST /v1/gate/evaluate`(不再 outbox PostPublish 内联自动评估)
- **2026-06-03** — 产品英文名 flashfi → WiseFlow;新增项目分组、注意力诊断、降噪页、今日版

下列文档**冻结在这些变更之前**(2026-05-25 ~ 05-26), 其对系统状态 / 架构的描述现已失真。

---

## 清单

| 文件 | 原位置 | 冻结于 | 为什么归档 | 现在看哪里 |
|---|---|---|---|---|
| [PROGRESS.md](PROGRESS.md) | `docs/` | 2026-05-25 | "操作面板"快照:称当前在 W0、四道门走 outbox 内联自动评估;未含 iii / 分析师 / 手动门 / 项目 / 注意力 / 降噪页 / 今日版 | [architecture-iii.html](../architecture-iii.html) + 各模块代码;路线图见 [GOAL/GOAL.md](../GOAL/GOAL.md) |
| [audit-phase1-completeness.html](audit-phase1-completeness.html) | `docs/` | 2026-05-25 | Phase 1 完成度审计的**基线快照**, 一次性产物 | 同上 |
| [architecture-analysis.html](architecture-analysis.html) | `docs/` | 2026-05-26 | "产品架构分析与完善建议", 成文于 iii 切换前, 多数建议已落地或被取代(仍引用 NATS) | [architecture-iii.html](../architecture-iii.html)(iii 切换后架构) |
| [first-principles-takeover.html](first-principles-takeover.html) | `docs/` | 2026-05-26 | 第一性原理分析, 早于 iii / 分析师 / 手动门 几轮 pivot | 同上 + [adr/](../adr/) |
| [iii-console-bug-report.md](iii-console-bug-report.md) | `docs/` | 2026-05-29 | 上游 iii console 崩溃的 issue 草稿;**已在 iii 0.16.1 修复**, 文首自述"保留作存档" | [ADR 0004](../adr/0004-iii-over-nats.md) · [SERVER.md](../../SERVER.md) |

---

## GOAL 建造任务单(同批归档)

`GOAL/` 下三个 Phase 的逐模块建造任务单——**为已完成、且此后架构已演进的工作写的施工图**。M1-M11 均已建完, 实现已超出当初计划(iii / 分析师 / 手动门 / 项目 / 注意力 / 降噪页 / 今日版 皆计划外新增), 这些"怎么建"的文档不再反映现状。详见 [GOAL/README.md](GOAL/README.md)。

- [`GOAL/phase-1-quiet/`](GOAL/phase-1-quiet/) — 00-overview + M1-M4
- [`GOAL/phase-2-ritual/`](GOAL/phase-2-ritual/) — 00-overview + IMPLEMENTATION_PLAN + M5-M8
- [`GOAL/phase-3-mirror/`](GOAL/phase-3-mirror/) — 00-overview + IMPLEMENTATION_PLAN + M9-M11

> 仍留在 `docs/GOAL/`: [`GOAL.md`](../GOAL/GOAL.md)(愿景 + 路线图)与 [`AGENT_BRIEF.md`](../GOAL/AGENT_BRIEF.md)(AI 元指令)——有效北极星, 非建造任务单。

---

## 没有归档的(它们跟上了)

为避免误伤, 以下文档虽然提到 NATS / 旧术语, 但**已更新到现状**, 留在原位:

- `技术文档/01·02 大纲` — 已写明"替代早期的 NATS JetStream / 现已切换到 iii", NATS 仅作历史。
- `GOAL/GOAL.md` · `GOAL/AGENT_BRIEF.md` — 终态愿景与给 AI 的元指令, 仍是有效北极星与工作准则, 留在原位。
- `adr/` 全部 — 决策记录按定义不可变, 永不归档(ADR 0004 本就是记录 NATS→iii)。
- `产品文档/`、`native_feel_skill/`、`api/openapi.yaml`、`architecture-iii.html` — 当前事实。
