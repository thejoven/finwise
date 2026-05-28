/**
 * LLM 模型工厂 · provider-neutral.
 *
 * 通过 @ai-sdk/openai 的 createOpenAI 工厂, 把 baseURL 指向任意 OpenAI 兼容后端.
 * 默认 DeepSeek; 切 OpenAI / Anthropic-via-proxy / Ollama / vLLM 只改 env.
 *
 * 所有 6 个 agent (Analyst/Socratic/Diagnosis/Narrator/Consensus/Editor/Diagnostician)
 * 都 import `defaultModel` 用, 这样换 provider 就改这一个文件.
 *
 * 注意 baseURL 不要带尾 `/v1` — createOpenAI 会自己加. DeepSeek 文档说 base_url
 * 可以是 `https://api.deepseek.com` 或 `https://api.deepseek.com/v1`, 我们用前者
 * (createOpenAI 默认补 `/v1`).
 */

import { createOpenAI } from "@ai-sdk/openai";

import { config } from "../config/env.js";

const provider = createOpenAI({
  apiKey: config.llmApiKey,
  baseURL: config.llmBaseURL.replace(/\/v1\/?$/, "") + "/v1", // 归一化, 不重复 /v1
  // DeepSeek / 任何其他 OpenAI-compat provider 都用这个对象拿 model.
});

/**
 * defaultModel — 主模型. 各 agent 用 model: defaultModel.
 * 模型名由 ANALYST_MODEL env 控制 (默认 deepseek-chat).
 */
export const defaultModel = provider(config.analyst.model);
