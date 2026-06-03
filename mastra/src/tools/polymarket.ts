/**
 * Polymarket 预测市场检索客户端.
 *
 * 用途: 给一条信号找"市场对类似事件的实时概率共识". 例如信号"美联储要降息了",
 * 搜出 Polymarket 上的"Fed decision in June"事件 + 各结果的隐含概率, 喂给 Analyst
 * 判断 consensus_check (你的判断 vs 市场), 同时作为 mobile「相关线索」里的概率条卡.
 *
 * 两步:
 *   1. extractMarketQueries(signalText) — 主模型把(多为中文的)信号压成英文搜索词.
 *   2. searchPolymarket(query)          — 打 gamma /public-search, 把 events→markets 映射成 SearchResult.
 *
 * API (公开, 无需 key):
 *   GET https://gamma-api.polymarket.com/public-search?q=<kw>&limit_per_type=<n>&events_status=active
 *   → { events: [ { title, slug, active, closed, volume, endDate, markets: [...] } ] }
 *   每个 market: { question, groupItemTitle, outcomes(JSON字符串), outcomePrices(JSON字符串), active, closed }
 *   二元市场的 "Yes" 价 = 市场认为该事件发生的概率 (0.62 → 62%).
 *
 * 设计准则 (对齐 exa-search.ts):
 *   - 失败不抛: 检索是增强材料. 没网络 / 被墙 / 超时 / 解析失败 → 返回 [], 主流程继续.
 *   - 进程内 60s 短缓存 — 同 query 重复打浪费.
 *   - POLYMARKET_ENABLED=false 时整条路径 no-op.
 */

import { config } from "../config/env.js";
import type { SearchResult, MarketOutcome } from "./exa-search.js";
import { extractMarketQueries } from "../agents/market-query.js";

export interface PolymarketOptions {
  /** 返回多少个 event (每个 = 一条线索). 1..10, 默认 4. */
  count?: number;
}

/** 每个 event 最多展示几个结果概率 (价格阶梯/多候选时取概率最高的前几条). */
const MAX_OUTCOMES = 4;
const CACHE_TTL_MS = 60_000;
const MAX_ATTEMPTS = 2;
const DOMAIN = "polymarket.com";

interface CacheEntry {
  expires: number;
  results: SearchResult[];
}
const cache = new Map<string, CacheEntry>();

// ───────────────────── 高层入口 (workflow 用) ─────────────────────

/**
 * searchPredictionMarkets — 信号文本 → 抽英文词 → 搜 Polymarket → SearchResult[] (kind="market").
 * 这是 workflow 该调的入口. 关闭 / 弱信号 / 失败一律返回 [].
 */
export async function searchPredictionMarkets(
  signalText: string,
  opts: PolymarketOptions = {},
): Promise<SearchResult[]> {
  if (!config.polymarket.enabled) return [];
  const text = (signalText ?? "").trim();
  if (!text) return [];

  const queries = await extractMarketQueries(text).catch(() => [] as string[]);
  if (queries.length === 0) return [];

  const count = clamp(opts.count ?? 4, 1, 10);
  // 取前 2 条查询并发搜, 合并去重 (按 url). 多数信号 1 条就够.
  const batches = await Promise.all(
    queries.slice(0, 2).map((q) => searchPolymarket(q, { count }).catch(() => [] as SearchResult[])),
  );
  return dedupeByUrl(batches.flat()).slice(0, count);
}

// ───────────────────── 低层: 单次关键词搜索 ─────────────────────

/**
 * searchPolymarket — 单条英文 query 打 gamma /public-search, 映射成 market 类 SearchResult[].
 * 失败返回 []. 直接拿英文 query 用 (不做抽词); workflow 一般走 searchPredictionMarkets.
 */
export async function searchPolymarket(
  query: string,
  opts: PolymarketOptions = {},
): Promise<SearchResult[]> {
  if (!config.polymarket.enabled) return [];
  const q = (query ?? "").trim();
  if (!q) return [];

  const count = clamp(opts.count ?? 4, 1, 10);
  const key = `${q}::${count}`;
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.results;

  const url = `${config.polymarket.searchUrl}?q=${encodeURIComponent(q)}&limit_per_type=${count}&events_status=active`;

  let lastErr: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const results = await searchOnce(url, count);
      cache.set(key, { expires: Date.now() + CACHE_TTL_MS, results });
      return results;
    } catch (err) {
      lastErr = err;
      if (attempt < MAX_ATTEMPTS) await sleep(400);
    }
  }
  logFailure(q, lastErr);
  return [];
}

async function searchOnce(url: string, count: number): Promise<SearchResult[]> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), config.polymarket.timeoutMs);
  try {
    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: ac.signal,
    });
    if (!res.ok) {
      throw new Error(`polymarket search ${res.status}`);
    }
    const data = (await res.json()) as PublicSearchResponse;
    const events = data?.events ?? [];
    const out: SearchResult[] = [];
    for (const ev of events) {
      const mapped = eventToResult(ev);
      if (mapped) out.push(mapped);
      if (out.length >= count) break;
    }
    return out;
  } finally {
    clearTimeout(timer);
  }
}

// ───────────────────── 映射: event → SearchResult ─────────────────────

interface RawMarket {
  question?: string;
  groupItemTitle?: string;
  outcomes?: string | string[];
  outcomePrices?: string | string[];
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
}
interface RawEvent {
  title?: string;
  slug?: string;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  volume?: number | string;
  endDate?: string;
  markets?: RawMarket[];
}
interface PublicSearchResponse {
  events?: RawEvent[];
}

function eventToResult(ev: RawEvent): SearchResult | null {
  if (!ev || ev.closed || ev.archived || ev.active === false) return null;
  const title = (ev.title ?? "").trim();
  const slug = (ev.slug ?? "").trim();
  if (!title || !slug) return null;

  const markets = (ev.markets ?? []).filter((m) => m && !m.closed && !m.archived && m.active !== false);
  if (markets.length === 0) return null;

  const outcomes = buildOutcomes(markets);
  if (outcomes.length === 0) return null;

  const volumeUsd = toNumber(ev.volume);
  const description = outcomes.map((o) => `${o.label} ${formatPct(o.probability)}`).join(" · ");

  return {
    title,
    url: `https://polymarket.com/event/${slug}`,
    description,
    age: ev.endDate ? formatEndDate(ev.endDate) : undefined,
    domain: DOMAIN,
    kind: "market",
    market: {
      outcomes,
      volumeUsd: volumeUsd && volumeUsd > 0 ? volumeUsd : undefined,
      endDate: ev.endDate,
    },
  };
}

/**
 * 把一个 event 的 markets 折成"结果→概率"列表:
 *   - 单 market 事件 (如 "Will Trump win?"): 直接用该 market 的 Yes/No 各结果价.
 *   - 多 market 事件 (价格阶梯 / 多候选): 每个 market 取其 Yes 价, 标签用 groupItemTitle.
 * 最后按概率降序, 截断到前 MAX_OUTCOMES.
 */
function buildOutcomes(markets: RawMarket[]): MarketOutcome[] {
  let raw: MarketOutcome[];
  if (markets.length === 1) {
    const m = markets[0];
    if (!m) return [];
    const labels = parseStrArray(m.outcomes);
    const prices = parseStrArray(m.outcomePrices).map(Number);
    raw = labels.map((label, i) => ({ label: label.trim(), probability: prices[i] ?? NaN }));
  } else {
    raw = markets.map((m) => {
      const labels = parseStrArray(m.outcomes);
      const prices = parseStrArray(m.outcomePrices).map(Number);
      const yesIdx = labels.findIndex((l) => l.trim().toLowerCase() === "yes");
      const probability = (yesIdx >= 0 ? prices[yesIdx] : prices[0]) ?? NaN;
      const label = (m.groupItemTitle || m.question || "").trim();
      return { label, probability };
    });
  }
  return raw
    .filter((o) => o.label.length > 0 && Number.isFinite(o.probability))
    .sort((a, b) => b.probability - a.probability)
    .slice(0, MAX_OUTCOMES);
}

// ───────────────────── helpers ─────────────────────

/** outcomes / outcomePrices 可能是 JSON 字符串 '["Yes","No"]' 或已是数组; 都吃下. */
function parseStrArray(v: string | string[] | undefined): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x));
  if (typeof v === "string" && v.trim()) {
    try {
      const parsed = JSON.parse(v);
      if (Array.isArray(parsed)) return parsed.map((x) => String(x));
    } catch {
      // 落到下面返回 []
    }
  }
  return [];
}

function toNumber(v: number | string | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** 0.62 → "62%"; 极小概率折成 "<1%" 避免显示 "0%". */
function formatPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<1%";
  if (p > 0.99 && p < 1) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** ISO 截止时间 → "截止 6/1". 解析失败返回 undefined-safe 文本. */
function formatEndDate(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "进行中";
  const d = new Date(t);
  return `截止 ${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function dedupeByUrl(items: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const it of items) {
    if (seen.has(it.url)) continue;
    seen.add(it.url);
    out.push(it);
  }
  return out;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function logFailure(q: string, err: unknown): void {
  console.warn(
    JSON.stringify({
      ts: new Date().toISOString(),
      level: "warn",
      msg: "polymarket search failed (silent)",
      query: q,
      err: err instanceof Error ? err.message : String(err),
    }),
  );
}
