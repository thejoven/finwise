# 05 · Mastra Agents & Workflows · 大纲

> 作者视角:**LLM 工程师**
> 这份文档回答:五个 Agent 的 prompt 怎么写、三个 Workflow 怎么编排、模型怎么选、流式怎么实现。

---

## 这份文档要回答的核心问题

1. 五个 Agent 的 system prompt 长什么样?
2. 每个 Agent 用什么模型,为什么?
3. Workflow 之间怎么编排,失败怎么处理?
4. Memory 用还是不用,什么场景用?
5. 怎么测试 LLM 输出?

---

## 章节结构

### § 1. Mastra 项目结构

```
/mastra
  /agents
    socratic-interviewer.agent.ts     # 五轮追问
    analyst.agent.ts                  # 推演 (两种模式)
    narrator.agent.ts                 # 承诺书叙述
    editor.agent.ts                   # 焦虑陪伴主笔按
    diagnostician.agent.ts            # 复盘四问
  /workflows
    signal-inference.workflow.ts      # 信号后台推演
    gate-prep.workflow.ts             # 门评估数据准备
    commitment-narration.workflow.ts  # 承诺书叙述生成
  /tools
    rag-search.tool.ts                # 调 Go 的 RAG 接口
    go-client.ts                      # 通用 Go HTTP 客户端
    embedding.tool.ts                 # OpenAI embedding
  /prompts
    *.prompt.md                       # 所有 prompt 用 markdown 单独管理
  /tests
    fixtures/                         # 历史信号样本
    *.test.ts                         # Agent 输出验收测试
```

### § 2. Agent 设计规范

每个 Agent 都遵循统一的 anatomy:

- **System Prompt** — 角色、约束、输出格式
- **Input Schema (Zod)** — 强类型输入
- **Output Schema (Zod)** — 强类型输出,JSON mode
- **Model Selection** — 不同 Agent 用不同模型
- **Temperature** — 大多数 0.3,叙述类 0.7
- **Tools** — 该 Agent 能调用哪些工具
- **Memory** — 用 / 不用 / 仅会话内

### § 3. 五个 Agent 完整设计

每个 Agent 一节,包含:

**§ 3.1 Socratic Interviewer (五轮追问)**
- 用途、调用场景
- System Prompt 全文(中文,这是产品语言)
- Input/Output schema
- 推荐模型:Claude Sonnet (擅长追问、克制)
- 关键约束:一次只问一个 / 不给答案 / 顺序固定

**§ 3.2 Analyst (推演)**
- 两种模式:`tagging` 和 `background_inference`
- System Prompt 按模式切换
- 推荐模型:Claude Sonnet (推理能力)
- Tools:rag-search

**§ 3.3 Narrator (承诺书)**
- 用途:四门全过后生成承诺书叙述
- System Prompt 全文 — 这是产品最重要的一段 prompt
- 推荐模型:Claude Opus / GPT-4 (文案质量决定签字率)
- Temperature 较高 (0.7)

**§ 3.4 Editor (焦虑陪伴)**
- 用途:E4 卡片的"主笔按"
- 关键约束:必须引用承诺书原文 / 不预测 / 只对照判据
- 推荐模型:Claude Opus (字字稳重)
- 非流式 — 反直觉设计,见文档 01 § 1

**§ 3.5 Diagnostician (复盘四问)**
- 用途:L5 复盘对话
- 严格按四问顺序、可中途终止 (第 1 问失败直接结束)
- 推荐模型:Claude Sonnet

### § 4. 三个 Workflow 完整设计

每个 Workflow 一节:

**§ 4.1 Signal Inference Workflow** (异步,触发自 NATS)
- 5 个 step,可重试
- 调用 Analyst Agent 两次(打标 + 推演)

**§ 4.2 Gate Prep Workflow** (同步,Go 主动调用)
- 4 个 step,准备结构化数据
- 输出 typed JSON 给 Go 规则引擎

**§ 4.3 Commitment Narration Workflow** (同步,Go 主动调用)
- 4 个 step,生成完整承诺书文案
- 调用 Narrator Agent

### § 5. RAG 检索策略

- Embedding 用 OpenAI `text-embedding-3-small` (便宜、足够)
- 检索范围:用户最近 90 天的信号 + 已签字承诺书
- top_k = 10,然后由 Analyst Agent 再过滤
- 不混合多用户数据(单用户向量空间隔离)

### § 6. Memory 使用规范

- 五轮追问 Agent:用 conversation memory,5 轮上限,会话结束清空
- 复盘四问 Agent:用 conversation memory,4 问上限,会话结束清空
- 其他 Agent:**不用** memory,每次调用都是无状态

### § 7. 流式响应实现

哪些 Agent 流式、怎么从 Mastra 流到 Go 到 Flutter 的 SSE:

```
Mastra Agent (token stream)
  → Go gateway (SSE 转发)
  → Flutter (SSE 解析)
```

中间不缓存,实时透传。

### § 8. Prompt 版本管理

- 所有 prompt 用 markdown 单独管理,不写死在代码里
- prompt 修改要写 changelog
- prompt 改动后跑回归测试(见 § 10)

### § 9. 模型选型与降级

| Agent | 主选模型 | 降级模型 | 理由 |
|---|---|---|---|
| Socratic | Claude Sonnet | GPT-4o-mini | 克制风格 |
| Analyst | Claude Sonnet | DeepSeek V3 | 推理能力 |
| Narrator | Claude Opus | GPT-4 | 文案质量 |
| Editor | Claude Opus | GPT-4 | 字字稳重 |
| Diagnostician | Claude Sonnet | DeepSeek V3 | 中等推理 |

降级触发:主模型限流 / 不可用。

### § 10. LLM 输出测试

特殊挑战:LLM 输出不是确定的,怎么测?

- **结构测试**:输出能 parse 为 Schema → 简单
- **属性测试**:满足若干硬约束 (如"输出不超过 4 句话") → 中等
- **回归测试**:固定 fixture 输入,输出与 baseline 语义相似度 (用 embedding 比较) → 复杂
- **人工评估**:抽样 + 评分卡 → 兜底

详细见文档 08。

---

## 关键决策预告

1. **每个 Agent 独立 system prompt,不共享** — 角色性格各异
2. **prompt 用 markdown 文件管理** — 改 prompt 不改代码
3. **流式 vs 非流式按"用户在等吗 + 仪式感需求"决定**
4. **Memory 只用于会话内追问** — 用户档案永远从 Go 拉
5. **Mastra 只通过 Go 接口访问数据** — 不直连数据库

---

## 交叉引用

- Mastra 调的 Go 内部接口 → 文档 04
- 推演结果如何变成事件回到 Go → 文档 03
- Workflow 失败的可观测性 → 文档 07
- LLM 输出验收测试 → 文档 08
