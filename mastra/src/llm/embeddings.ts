/**
 * Embeddings provider · 阿里通义灵积 text-embedding-v3 (OpenAI 兼容接口).
 *
 * 用在 vector store 索引 / 查询. deepseek-chat 没自己的 embeddings, 走 dashscope.
 * 维度: 1024 (v3 默认), 与 pgvector 索引一致.
 *
 * 文档: https://help.aliyun.com/zh/dashscope/developer-reference/text-embedding-v3
 * baseURL: https://dashscope.aliyuncs.com/compatible-mode/v1
 *
 * 失败时不 fallback — 上层 (thicknessJudge) 自己处理 timeout/error.
 */

import { createOpenAI } from "@ai-sdk/openai";

import { config } from "../config/env.js";

const dashscope = createOpenAI({
  baseURL: config.embeddings.baseURL,
  apiKey: config.embeddings.apiKey,
});

export const embeddingModel = dashscope.embedding(config.embeddings.model);

/** 1024 维 (text-embedding-v3 默认). 与 pgvector index 维度必须一致. */
export const EMBEDDING_DIM = 1024;
