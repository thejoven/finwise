# ADR 0003 · LLM 编排选 Mastra, 不选 LangChain / 裸 SDK

- 状态: Accepted
- 日期: 2026-05-25
- 模块: M2 信号管道

## 上下文

财富密码 需要在 Node 进程里跑 LLM 推演:
- 接受结构化输入 (signal.captured payload)
- 调一个或多个 Agent (Analyst 是第一个; Phase 2 还会有 Socratic Refinement, Gate, Narrator, Editor, Diagnostician)
- 输出严格 schema (zod)
- 把结果写回 Go 后端

候选:

1. **裸 @ai-sdk/anthropic** — Vercel AI SDK, 最薄
2. **LangChain JS** — 老牌
3. **LangGraph** — LangChain 的状态机变体
4. **Mastra** — 较新, 内置 Agent + Workflow + Tool 概念

## 决策

**用 Mastra**, 同时**保留 prompt + zod schema 在我们自己的代码里**, 不让框架吞掉.

## 为什么

- **Agent + Workflow 是一等概念**. Phase 2 会有 5+ 个 Agent 走有状态对话 (五轮追问). Mastra 的 Workflow 接近"我心里那个模型"——steps + retries + observability 三件套出厂.
- **zod 集成原生**. 直接 `output: InferenceSchema`, 失败抛错, 不像 LangChain 要靠 OutputParser 链.
- **AI SDK 兼容**. Mastra 底下用 Vercel AI SDK, 模型切换 (Anthropic → OpenAI → 自托管) 改一行.
- **代码量少, 不蛀**. 跟 LangChain 比, Mastra 的源代码量小一个量级. 我们 Phase 1 用的 surface area 极小 (Agent + 一次 generate), 切走也成本可控.

## 为什么不选 LangChain JS

- 抽象过重 (Runnable / Chain / Tool / OutputParser / Memory / Retriever 7 层), 我们的用例不需要
- 中文社区的反馈相对负面: API 变化频繁、breaking changes 多
- Phase 2 的对话状态用 LangGraph 也能做, 但 graph 编排比我们要的"几个固定步骤"重

## 为什么不裸 SDK

- M2 之后会有 5+ Agent. 裸 SDK 写下去每个 Agent 都要自己处理 retry / schema 校验 / 日志 / 模型 fallback. 重复劳动.
- 失去未来加 RAG / 工具调用时的脚手架

## 后果

- **新依赖**: `@mastra/core`, `@ai-sdk/anthropic`, `ai`, `zod`
- **prompt 必须在我们仓库里, 不在 Mastra 配置文件里**. Agent 的 instructions 写死在 `src/agents/<name>.ts`, 这样它能跟代码一起 review/diff.
- **如果 Mastra 1.0 之前 breaking change 太多**, 撤回成本: Agent → 裸 generate (代码层很薄), Workflow → 手写 try/catch (10 行).

## 复盘条件

任意以下出现一项, 重新评估:
1. Mastra 升级一次破坏 3 处以上 Agent
2. Phase 2 的对话状态机用 Mastra Workflow 表达不出来
3. 单条推演成本因为 Mastra 中间层加了 > 30% latency
