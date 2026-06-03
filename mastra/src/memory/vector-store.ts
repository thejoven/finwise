/**
 * Signal Vector Store · 包装 @mastra/pg 的 PgVector.
 *
 * 用于 thicknessJudge 的 RAG 召回. 不走 mastra Memory 的 chat abstraction —
 * 我们的 use case 是"signal embedding store", 不是聊天历史.
 *
 * 数据模型:
 *   - indexName: signal_summaries
 *   - 一条 vector = 一个 signal 的 inference_summary embedding
 *   - metadata: { user_id, signal_id, summary, tags, captured_at, project_id? }
 *   - filter: { user_id } 按用户隔离; 召回时可叠加 project_id 做"同分类优先"
 *
 * 表自动创建在 mastra schema 下 (PgVector 第一次 createIndex 时建).
 * 复用 .205 的 postgres + pgvector 容器, 不引入新进程.
 *
 * 设计准则:
 *   - 同 exa-search: indexSignal 失败不抛, 上游主流程不被打断
 *   - recallSimilar 失败抛, 由 thicknessJudge 决定 fallback
 */

import { embed, embedMany } from "ai";
import { PgVector } from "@mastra/pg";

import { config } from "../config/env.js";
import { EMBEDDING_DIM, embeddingModel } from "../llm/embeddings.js";

export interface SignalMetadata {
  user_id: string;
  signal_id: string;
  summary: string;
  tags: string[];
  captured_at: string; // ISO RFC3339
  project_id?: string; // 分类 (capture 时快照); 缺省 = 未分类. 召回时用于"同分类优先"
}

let _vector: PgVector | null = null;
let _indexInitialized = false;

function getVector(): PgVector {
  if (_vector) return _vector;
  _vector = new PgVector({
    connectionString: config.vectorStore.connectionString,
    schemaName: config.vectorStore.schemaName,
  });
  return _vector;
}

async function ensureIndex(): Promise<void> {
  if (_indexInitialized) return;
  const v = getVector();
  try {
    await v.createIndex({
      indexName: config.vectorStore.signalIndex,
      dimension: EMBEDDING_DIM,
      metric: "cosine",
    });
    _indexInitialized = true;
  } catch (err: unknown) {
    // 已存在不算错
    const msg = err instanceof Error ? err.message : String(err);
    if (/already exists/i.test(msg)) {
      _indexInitialized = true;
      return;
    }
    throw err;
  }
}

/**
 * indexSignal · 把一条 signal 的 inference_summary embed 后写入 vector store.
 *
 * 调用时机: signal-inference workflow inference done 之后. 失败静默 (log warn),
 * 不影响主流程 — RAG 是增强, 不是核心.
 *
 * 幂等: ids = [signal_id] 让 upsert 覆盖, 重复 inference 不会插重.
 */
export async function indexSignal(meta: SignalMetadata): Promise<void> {
  if (!config.embeddings.apiKey) {
    // 没配 embeddings key, 整个 RAG 功能 no-op
    return;
  }
  await ensureIndex();
  // 用 summary + tags 拼成 embedding 文本 (比单 summary 信息更完整)
  const embedText = `${meta.summary}\n标签: ${meta.tags.join(", ")}`;
  const { embedding } = await embed({ model: embeddingModel, value: embedText });
  await getVector().upsert({
    indexName: config.vectorStore.signalIndex,
    vectors: [embedding],
    metadata: [meta as unknown as Record<string, unknown>],
    ids: [meta.signal_id],
  });
}

export interface RecalledSignal {
  signal_id: string;
  summary: string;
  tags: string[];
  captured_at: string;
  score: number; // cosine similarity (0..1)
}

/**
 * recallSimilar · 按 queryText 召回当前 user 最相关的 top-k 历史 signal summary.
 *
 * filter 始终按 user_id 隔离 — 一个 user 看不到别人的信号.
 *
 * 传 project_id 时走"同分类优先"混合召回:
 *   1. 先在同分类 (user_id + project_id) 里召回最相关的 ≤ top_k 条;
 *   2. 不足 top_k → 再按 user_id 全量召回, 去重后用跨分类的补齐到 top_k.
 * 同分类条目永远排在前面 (优先级), 跨分类只做兜底. 不传 project_id (信号未分类)
 * 则退回纯 user_id 的旧行为.
 *
 * 存量向量没写 project_id, 同分类查询匹配不到它们 — 会自然落到补齐档, 无需回填.
 */
export async function recallSimilar(args: {
  user_id: string;
  query_text: string;
  top_k?: number;
  exclude_signal_id?: string; // 排除当前正在评估的信号本身
  project_id?: string; // 当前信号的分类; 传了就"同分类优先", 不传/为空 = 纯跨分类
}): Promise<RecalledSignal[]> {
  if (!config.embeddings.apiKey) return [];
  await ensureIndex();
  const topK = args.top_k ?? 10;
  const { embedding } = await embed({ model: embeddingModel, value: args.query_text });
  const v = getVector();
  const indexName = config.vectorStore.signalIndex;

  // query 结果 → RecalledSignal[] (排除当前信号自己)
  const toRecalled = (
    results: Array<{ metadata?: unknown; score: number }>,
  ): RecalledSignal[] =>
    results
      .filter((r) => {
        const m = r.metadata as SignalMetadata | undefined;
        return m && m.signal_id !== args.exclude_signal_id;
      })
      .map((r) => {
        const m = r.metadata as SignalMetadata;
        return {
          signal_id: m.signal_id,
          summary: m.summary,
          tags: m.tags,
          captured_at: m.captured_at,
          score: r.score,
        };
      });

  // 未分类 → 纯跨分类召回 (旧行为)
  if (!args.project_id) {
    const all = await v.query({
      indexName,
      queryVector: embedding,
      topK,
      filter: { user_id: { $eq: args.user_id } },
    });
    return toRecalled(all).slice(0, topK);
  }

  // 同分类优先
  const sameRes = await v.query({
    indexName,
    queryVector: embedding,
    topK,
    filter: { user_id: { $eq: args.user_id }, project_id: { $eq: args.project_id } },
  });
  const same = toRecalled(sameRes);
  if (same.length >= topK) return same.slice(0, topK);

  // 不足 → 跨分类补齐 (多召回 same.length 条, 抵消去重损耗后仍够填满 topK)
  const fillRes = await v.query({
    indexName,
    queryVector: embedding,
    topK: topK + same.length,
    filter: { user_id: { $eq: args.user_id } },
  });
  const seen = new Set(same.map((s) => s.signal_id));
  const fill = toRecalled(fillRes).filter((r) => !seen.has(r.signal_id));
  return [...same, ...fill].slice(0, topK);
}

/** 让 graceful shutdown 关连接池. */
export async function disposeVector(): Promise<void> {
  if (_vector) {
    try {
      await _vector.disconnect();
    } catch {
      // ignore
    }
    _vector = null;
    _indexInitialized = false;
  }
}
