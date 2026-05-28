/**
 * Exa.ai Web Search 客户端.
 *
 * Mastra 在两处用它:
 *   1. signal-inference workflow (Analyst 阶段) — 用 signal 原文做一次 broad search,
 *      把当下的真实新闻喂给 Analyst, 让推演不靠预训练记忆瞎编.
 *   2. refinement-step workflow (Socratic 每轮) — 按当前轮主导 lens 构造定向查询,
 *      把"这条 lens 怎么看这条信号"的鲜活材料喂给出题.
 *
 * 为什么 Exa: neural / auto 模式对"反共识 / 二阶链条"这种概念性查询比关键字搜索好;
 * highlights 已经是清洗过的 LLM-friendly 片段, 不需要二次抓取.
 *
 * API: POST https://api.exa.ai/search
 *   - 鉴权: 头 x-api-key
 *   - body 关键字段: query / numResults / type ('auto'|'neural'|'keyword') / contents.highlights
 *   - 时间过滤: startPublishedDate / endPublishedDate (ISO 8601)
 *
 * 设计准则:
 *   - 单次失败不抛: 搜索是"增强信息", 不是核心路径. 失败时返回空数组, workflow 继续跑.
 *   - 进程内 60s 短缓存 — 同一 query 重复打浪费 token.
 *   - 调用方对外形状用 SearchResult — provider 中性, 以后换 Tavily/Serper 仅这一层动.
 */
import { config } from "../config/env.js";

export interface SearchResult {
  title: string;
  url: string;
  /** 来自 Exa highlights[0]; 客户端展示用 2-3 句话片段. */
  description: string;
  /** 人类可读相对时间, 例 "2 天前". 没 publishedDate 时 undefined. */
  age?: string;
  /** 从 url 解出的 hostname (去掉 www.), 客户端展示用. */
  domain: string;
}

export interface WebSearchOptions {
  /** 1..25. Exa search 单次最多 25 条. */
  count?: number;
  /** 时间窗口语义化. provider-中性, 内部翻译成 Exa 的 startPublishedDate. */
  freshness?: "day" | "week" | "month" | "year";
  /**
   * Exa-only 检索模式. 'auto' 让 Exa 自己挑 neural vs keyword (默认),
   * 'neural' 强制语义检索 (适合反共识 / 概念查询),
   * 'keyword' 强制关键字 (适合专有名词).
   */
  type?: "auto" | "neural" | "keyword";
}

const MAX_ATTEMPTS = 2;
const CACHE_TTL_MS = 60_000;

interface CacheEntry {
  expires: number;
  results: SearchResult[];
}
const cache = new Map<string, CacheEntry>();

/**
 * 主入口. query 空时直接返回空数组 (不打 API).
 * 当 EXA_API_KEY 未配置时也返回空 — 让搜索是 opt-in, 没 key 不影响主流程.
 */
export async function webSearch(
  query: string,
  opts: WebSearchOptions = {},
): Promise<SearchResult[]> {
  const q = (query ?? "").trim();
  if (!q) return [];
  if (!config.exa.apiKey) return [];

  const count = clamp(opts.count ?? 5, 1, 25);
  const type = opts.type ?? "auto";
  const key = cacheKey(q, count, opts);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.results;

  const body: Record<string, unknown> = {
    query: q,
    numResults: count,
    type,
    contents: {
      // 2-3 句中文左右; 已清洗 (没有 html 残留), 直接喂 LLM 或渲染.
      highlights: { numSentences: 3, highlightsPerUrl: 1 },
    },
  };
  // type=auto 时让 Exa 自动改写 query (neural 模式效果更好).
  if (type !== "keyword") {
    body.useAutoprompt = true;
  }
  const startDate = freshnessToStartDate(opts.freshness);
  if (startDate) body.startPublishedDate = startDate;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = await searchOnce(body);
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, results });
      return results;
    } catch (err) {
      lastErr = err;
      if (!shouldRetry(err) || attempt === MAX_ATTEMPTS) break;
      // 429 短等 1.2s; 其它错误下次直接重试.
      await sleep(err instanceof ExaError && err.status === 429 ? 1200 : 400);
    }
  }
  logExaFailure(q, lastErr);
  return [];
}

class ExaError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ExaError";
  }
}

async function searchOnce(body: Record<string, unknown>): Promise<SearchResult[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.exa.timeoutMs);
  try {
    const res = await fetch(config.exa.searchUrl, {
      method: "POST",
      headers: {
        "x-api-key": config.exa.apiKey!,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(body),
      signal: ac.signal,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new ExaError(`exa search ${res.status}: ${text.slice(0, 200)}`, res.status);
    }
    const data = (await res.json()) as ExaApiResponse;
    const items = data?.results ?? [];
    return items.map(normalize);
  } finally {
    clearTimeout(timer);
  }
}

interface ExaApiResponse {
  results?: Array<{
    title?: string | null;
    url?: string;
    publishedDate?: string | null;
    author?: string | null;
    highlights?: string[];
    text?: string;
  }>;
}

function normalize(raw: {
  title?: string | null;
  url?: string;
  publishedDate?: string | null;
  highlights?: string[];
  text?: string;
}): SearchResult {
  const url = raw.url ?? "";
  const description = pickDescription(raw.highlights, raw.text);
  return {
    title: (raw.title ?? "").trim(),
    url,
    description,
    age: formatAge(raw.publishedDate ?? undefined),
    domain: safeHostname(url),
  };
}

function pickDescription(highlights?: string[], text?: string): string {
  const first = highlights?.[0];
  if (first) return first.trim();
  if (text) {
    // text 模式可能返回整页, 截 220 字够当摘要.
    return text.slice(0, 220).trim();
  }
  return "";
}

function safeHostname(u: string): string {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function shouldRetry(err: unknown): boolean {
  if (err instanceof ExaError) {
    return err.status === 429 || err.status >= 500;
  }
  // 网络/超时 重试
  return true;
}

function freshnessToStartDate(freshness?: WebSearchOptions["freshness"]): string | undefined {
  if (!freshness) return undefined;
  const days: Record<NonNullable<WebSearchOptions["freshness"]>, number> = {
    day: 1,
    week: 7,
    month: 30,
    year: 365,
  };
  const ms = days[freshness] * 86400_000;
  return new Date(Date.now() - ms).toISOString();
}

function formatAge(iso?: string): string | undefined {
  if (!iso) return undefined;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return undefined;
  const diffSec = Math.max(0, (Date.now() - t) / 1000);
  if (diffSec < 60) return "刚刚";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)} 小时前`;
  if (diffSec < 86400 * 30) return `${Math.floor(diffSec / 86400)} 天前`;
  if (diffSec < 86400 * 365) return `${Math.floor(diffSec / (86400 * 30))} 个月前`;
  return `${Math.floor(diffSec / (86400 * 365))} 年前`;
}

function cacheKey(q: string, count: number, opts: WebSearchOptions): string {
  return `${q}::${count}::${opts.freshness ?? ""}::${opts.type ?? "auto"}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logExaFailure(q: string, err: unknown): void {
  const entry = {
    ts: new Date().toISOString(),
    level: "warn",
    msg: "exa search failed (silent)",
    query: q,
    err: err instanceof Error ? err.message : String(err),
  };
  console.warn(JSON.stringify(entry));
}
