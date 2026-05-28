/**
 * Shared per-user Memory · @mastra/memory + Postgres + PgVector.
 *
 * 单例 Memory: 全局只 new 一次, 通过 agent.generate 的 memory.resource = user_id
 * 做 per-user 隔离 (Mastra 内部按 resourceId 查 thread / messages / vector).
 *
 * 存储:
 *   - Threads / messages → PostgresStore (mastra schema, 表 auto-create 在首次写入)
 *   - Semantic recall    → PgVector (复用 .205 已有的 postgres + pgvector)
 *   - Embeddings         → dashscope text-embedding-v3 (1024 维)
 *
 * 行为 (MemoryConfig):
 *   - lastMessages: 10                — 最近 10 条 chat 给 agent 看
 *   - semanticRecall.scope: 'resource'— 跨 thread 召回, 但**绝不**跨 user
 *   - workingMemory.enabled: true     — 让 agent 自己维护一份 markdown 用户档案
 *
 * 没配 embedding key 时 vector=false → 仍能记 thread, 只是没语义召回. 与
 * signal vector store 同一个 no-op 策略.
 *
 * 与 signal vector-store 关系:
 *   - signal vector-store: 用户**信号** embedding, indexName=signal_summaries
 *   - 本文件 Memory:       agent**对话**与 working memory, Mastra 内部 index
 *   两个 index 互不干扰, 共用同一 connectionString + schema.
 */

import { Memory } from "@mastra/memory";
import { PgVector, PostgresStore } from "@mastra/pg";

import { config } from "../config/env.js";
import { embeddingModel } from "../llm/embeddings.js";

let _memory: Memory | null = null;
let _store: PostgresStore | null = null;
let _vector: PgVector | null = null;

function build(): Memory {
  _store = new PostgresStore({
    connectionString: config.vectorStore.connectionString,
    schemaName: config.vectorStore.schemaName,
  });

  const hasEmbeddings = !!config.embeddings.apiKey;
  if (hasEmbeddings) {
    _vector = new PgVector({
      connectionString: config.vectorStore.connectionString,
      schemaName: config.vectorStore.schemaName,
    });
  }

  return new Memory({
    // PostgresStore@0.10.3 与 @mastra/core@0.10.x 类型上 supports.resourceWorkingMemory 缺失
    // 但运行时兼容 — Memory 自己会 feature-detect (checkStorageFeatureSupport).
    // 升 @mastra/pg 需要拉 0.11+ 系列, 影响 PgVector 行为, 暂用 unknown 桥.
    storage: _store as unknown as ConstructorParameters<typeof Memory>[0] extends infer C
      ? C extends { storage?: infer S } ? S : never : never,
    vector: hasEmbeddings && _vector ? _vector : false,
    embedder: hasEmbeddings ? embeddingModel : undefined,
    options: {
      lastMessages: 10,
      semanticRecall: hasEmbeddings
        ? { topK: 5, messageRange: { before: 2, after: 1 }, scope: "resource" }
        : false,
      workingMemory: {
        enabled: true,
        template: WORKING_MEMORY_TEMPLATE,
      },
    },
  });
}

/** 工程哲学: 用户档案是 agent 自己写的 — 不预设字段值, 只给结构 */
const WORKING_MEMORY_TEMPLATE = `
# 用户研究档案 (working memory)

## 持仓与风格
- 当前主要持仓 (asset + 仓位粗略):
- 风险偏好 (从签字 / 焦虑日观察出来的, 不是用户自报):
- 典型 holding period:

## lens 倾向
- 最常用的 lens (L1 根因 / L4 反身性 / L5 base rate / ...):
- 最薄弱的 lens (诊断结论里反复出现的):

## 历史决策模式
- 焦虑日触发器:
- 退出条件清晰度:
- 命题演化能力:

## 注意事项 (写下用户希望 agent 记住的偏好 / 红线)
-
`.trim();

/**
 * getMemory · 拿全局 Memory 单例. agent 构造时挂上去.
 *
 * Per-user 隔离不是通过 N 个 Memory 实例 — Mastra Memory 设计上就是 one instance
 * scoping by resourceId. agent.generate(..., { memory: { resource: user_id, thread } })
 * 时 Mastra 内部 SQL 加 WHERE resource_id = ?.
 */
export function getMemory(): Memory {
  if (_memory) return _memory;
  _memory = build();
  return _memory;
}

/** graceful shutdown · 关 pg 连接池 */
export async function disposeMemory(): Promise<void> {
  try {
    if (_vector) await _vector.disconnect();
  } catch {
    // ignore
  }
  // PostgresStore 没有公开 disconnect — 进程退出时由 OS 收
  _vector = null;
  _store = null;
  _memory = null;
}
