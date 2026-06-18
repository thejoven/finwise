/**
 * Env loader. Minimal — no dotenv-flow, no zod-config — just typed accessors.
 *
 * Mastra runs as a long-lived process; we read env at boot and surface a
 * single typed config. Anything missing fails fast with a clear message.
 *
 * LLM provider: 通过 OpenAI 兼容接口接 DeepSeek (或任何其他 OpenAI-compat 后端).
 * 切换 provider 只改 LLM_BASE_URL + LLM_API_KEY + ANALYST_MODEL 三个 env, 不动代码.
 */

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`missing required env var: ${name}`);
  }
  return v;
}

function optional(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== "" ? v : fallback;
}

function optionalNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number(raw);
  if (Number.isNaN(n)) throw new Error(`env ${name} is not a number`);
  return n;
}

/**
 * llmApiKey/llmBaseURL 兼容旧 ANTHROPIC_API_KEY 命名: 任一存在即可,
 * 这样旧 .env 不立刻报错. 优先 LLM_API_KEY (provider-neutral).
 *
 * baseURL 默认指 DeepSeek; 想换 OpenAI / Anthropic-via-proxy / Ollama / vLLM 都改 env.
 */
function readLLMKey(): string {
  return optional("LLM_API_KEY") ?? optional("DEEPSEEK_API_KEY") ?? required("ANTHROPIC_API_KEY");
}

export const config = {
  llmApiKey: readLLMKey(),
  llmBaseURL: optional("LLM_BASE_URL", "https://api.deepseek.com")!,

  iiiUrl: optional("III_URL", "ws://localhost:49134")!,

  alphaxApiUrl: optional("ALPHAX_API_URL", "http://localhost:8080")!,
  internalToken: required("INTERNAL_TOKEN"),

  // 默认 deepseek-chat (公开模型). 用户想用 v4-pro 或其他, 改 ANALYST_MODEL env.
  // 注意: 模型名必须是 provider 那边真实存在的, 否则 4xx.
  analyst: {
    model: optional("ANALYST_MODEL", "deepseek-chat")!,
    maxTokens: optionalNumber("ANALYST_MAX_TOKENS", 1500),
    temperature: optionalNumber("ANALYST_TEMPERATURE", 0.3),
  },

  // HTTP 服务: Go 同步调 Mastra 用. 默认本机, 部署到内网可 bind 0.0.0.0.
  http: {
    bind: optional("MASTRA_HTTP_BIND", "127.0.0.1")!,
    port: optionalNumber("MASTRA_HTTP_PORT", 9090),
  },

  // Exa.ai Web Search — Analyst/Socratic 给 signal 做实时检索.
  // 没配 EXA_API_KEY 时整条搜索路径会静默 no-op, 不影响主流程.
  // Docs: https://exa.ai/docs · Dashboard: https://dashboard.exa.ai
  exa: {
    apiKey: optional("EXA_API_KEY"),
    searchUrl: optional("EXA_SEARCH_URL", "https://api.exa.ai/search")!,
    timeoutMs: optionalNumber("EXA_SEARCH_TIMEOUT_MS", 8000),
  },

  // Polymarket 预测市场检索 — 给信号找"市场对类似事件的实时概率共识", 喂 Analyst 的 consensus_check.
  // 公开 gamma API, 无需 key. 没网络/被墙/超时时静默 no-op (返回空), 不影响主流程.
  // 想关掉: POLYMARKET_ENABLED=false. 想走代理: 改 POLYMARKET_SEARCH_URL.
  // Docs: https://docs.polymarket.com · Endpoint: GET /public-search?q=<kw>&events_status=active
  polymarket: {
    enabled: optional("POLYMARKET_ENABLED", "true") !== "false",
    searchUrl: optional("POLYMARKET_SEARCH_URL", "https://gamma-api.polymarket.com/public-search")!,
    timeoutMs: optionalNumber("POLYMARKET_TIMEOUT_MS", 8000),
  },

  // Embeddings (thicknessJudge / RAG 用). 默认走阿里通义灵积 text-embedding-v3 (OpenAI compat).
  // 国内访问稳, 1024 维, 价格低. 想换 jina / openai 改这三个 env 即可.
  embeddings: {
    apiKey: optional("DASHSCOPE_API_KEY") ?? optional("EMBEDDING_API_KEY") ?? "",
    baseURL: optional("EMBEDDING_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1")!,
    model: optional("EMBEDDING_MODEL", "text-embedding-v3")!,
  },

  // pgvector store (复用 .205 已有 postgres, 走 mastra schema 隔离).
  vectorStore: {
    connectionString: optional("MASTRA_PG_URL") ?? optional("DATABASE_URL", "postgres://alphax:alphax@localhost:5432/alphax")!,
    schemaName: optional("MASTRA_PG_SCHEMA", "mastra")!,
    signalIndex: optional("MASTRA_SIGNAL_INDEX", "signal_summaries")!,
  },

  logLevel: optional("LOG_LEVEL", "info")!,
} as const;

export type AppConfig = typeof config;
