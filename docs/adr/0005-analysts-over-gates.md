# ADR 0005: Named analysts over "四道门" + all-LLM judgment

- 状态: Accepted
- 日期: 2026-05-30
- 相关: [ADR 0003 (Mastra over LangChain)](0003-mastra-over-langchain.md) · [第三层 · 确定性评估](../产品文档/03_第三层_确定性评估.md) · [M6 gate engine (归档)](../归档/GOAL/phase-2-ritual/M6-gate-engine.md)

## Context

第三层的确定性评估原本叫**"四道门"**：信号在追问（M5）完成后过 G1（厚度）、G2（反共识）、G3（窗口）、G4（能力圈）四道门，任一失败即沉默归档。

两个问题：

1. **概念抽象、用户不好理解。** "门 1 / 门 2 / 第 3 道没过"对用户没有任何语义——它不解释"是谁、凭什么、否决了什么"。
2. **判断半写死。** G1、G2 已经是 LLM 判断（Mastra `thickness_judge` / `consensus_check`），但 **G3 是写死的"持仓 1-6 个月才过"区间规则，G4 是写死的"诊断 kind + 退出关键词命中"启发式**。同一层里两种判断范式并存，G3/G4 既不智能也不可解释。

## Decision

### 1. 把"四道门"重命名为"四位分析师"（产品语言层）

| 原 | 现 | 只回答一个问题 | 失败归档池 |
|---|---|---|---|
| 门 1 · 厚度 | **佐证分析师** | 证据够不够厚、够不够独立？ | observation |
| 门 2 · 反共识 | **共识分析师** | 市场是不是已经都知道、都定价了？ | discard |
| 门 3 · 窗口 | **时机分析师** | 现在出手是不是太早或太晚？ | calendar |
| 门 4 · 能力圈 | **能力圈分析师** | 你凭什么比市场更懂这件事？ | lesson |

命名是 UI / 文案 / prompt 层的"概念外衣"，**底层数据结构不变**——`gate_evaluations.gates_detail` 的 `g1_thickness` / `g2_anti_consensus` / `g3_window` / `g4_edge` 键、`failed_gate` (1..4)、四个归档池都保持原样，**不需要 DB migration**。命名的单一事实源在三处保持一致：`mastra/src/agents/analysts.ts`、`server/.../gate/service.go`、`mobile/src/core/api/gate.ts`。

### 2. 四位分析师全部由 LLM (Mastra) 判断

新增两个 Mastra agent + HTTP 端点，补齐原本写死的两道：

- **时机分析师** — `mastra/src/agents/timing.ts` → `POST /timing-check`：LLM 判催化剂时序 / 前瞻窗口是否成立（年度催化剂的长窗口也能过，已落地的事件即使月数合规也不过），把用户声明的持仓月数作为输入之一。
- **能力圈分析师** — `mastra/src/agents/competence.ts` → `POST /competence-check`：LLM 判"能解释根因"与"给得出可证伪退出条件"两个认知项；"是否亲历"仍是元数据，最终 `pass = explain ∧ direct ∧ exit_known` 由 Go 综合。

沿用 G1/G2 已有的**"LLM 优先 + 启发式兜底"**模式：Mastra 未配置 / 超时 / 报错时，G3 回退到原"1-6 个月"区间规则，G4 回退到原"诊断 kind + 退出关键词"启发式。集成测试用空 Mastra client 跑，因此走的就是兜底路径，行为与改造前一致。

### 3. 四位分析师并行评估

原 `Evaluate()` 串行调四道门，G1/G2 是同步 LLM 调用；补上 G3/G4 的 LLM 调用后，串行会把 4 次 LLM 往返延迟叠加（最坏 ~50s+）。改为 `sync.WaitGroup` 并行，墙钟 ≈ 最慢的一位（~15s）。四位只读 refinement context，彼此独立，无数据竞争。

### 4. 否决理由用分析师口吻

`classifyFailure` 的 `human_reason` 优先采用该分析师 LLM 给出的一句话 `reasoning`（面向用户、可解释），无则退回分析师口吻的固定文案（"共识分析师：这件事市场已经讨论得很热了……"）。

## Consequences

- **正面**：概念直观（"共识分析师认为已被定价"远胜"门 2 没过"）；四道判断范式统一为 LLM，可解释、可演化；延迟因并行不增反控；零 DB migration。
- **代价**：每次评估固定多两次 LLM 调用（timing + competence），成本与 token 增加；G3/G4 判断从确定性规则变为 LLM，需靠 prompt 约束 + 兜底保证稳定性。
- **回退**：任一新 agent 出问题，Mastra 端点报错即自动走 Go 侧启发式兜底，不阻塞主流程。

## 更新 (2026-06) · 共识分析师从"拦门"到"指方向"

共识分析师 (G2) 判定"已被定价"（score ≥ 70）时不再只是把信号扔进舍弃池，额外给出 `unpriced_directions`（≤3 条）：市场还没定价的相邻方向 / 二阶角度（"往哪看"，不荐股），死路变线索。实现：mastra `consensus.ts` schema 新增字段 → Go `domain.GateG2.UnpricedDirections`（`gates_detail` JSONB 加字段，**延续本 ADR 的零 migration**）→ mobile 评审卡 + 舍弃池视图。守住不荐股红线：不写买入 / 目标价 / 估值 / 数字——估值落地是受益链分析师（Beneficiary）的职责，两者分工不重叠。
