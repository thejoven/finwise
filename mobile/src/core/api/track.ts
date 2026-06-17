/**
 * /v1/{signals,commitments,assets}/* 标的追踪端点的 typed 客户端封装.
 * 与 server/internal/module/asset/handler.go 的 DTO 对齐 (照 gate.ts 写法).
 *
 * 口径 (§7 数据诚实):
 *   - pct_since_* 是**小数** (0.15 = +15%), 渲染处统一 × 100, 见 features/track/format.
 *   - 不可追踪标的 (加密/未上市/海外/篮子): asset.status="untrackable" + bars:[] +
 *     各 close/pct 缺省. UI 显示"无法追踪此标的", **不画假线**.
 *   - 锚点 anchor_at 冻结于解析时的 signal.captured_at; 承诺额外带 signed_at.
 *   - 字段宽松 (nullable + optional): untrackable track 只有 asset/role/anchor_at/bars,
 *     signal track 无签字日字段 (signed_at/sign_close/pct_since_sign).
 */

import { z } from "zod";
import { api } from "./client";

/** 规范标的注册表里的一条 (assets 表投影). market: a|hk|us|other; status: active|delisted|untrackable. */
export const TrackAsset = z.object({
  id: z.string().uuid(),
  canonical: z.string(),
  exchange: z.string().optional().default(""),
  market: z.string(),
  name: z.string(),
  provider_symbol: z.string().optional(),
  type: z.string().optional(),
  status: z.string(),
});
export type TrackAsset = z.infer<typeof TrackAsset>;

/** 追踪曲线用的轻量日线点 (只要 date + close). */
export const TrackBar = z.object({
  date: z.string(),
  close: z.number(),
});
export type TrackBar = z.infer<typeof TrackBar>;

/**
 * 一条"标的 ↔ 命题"的追踪记录. 价格字段在 untrackable 时全缺省,
 * 签字字段 (signed_at/sign_close/pct_since_sign) 仅承诺 track 有.
 */
export const Track = z.object({
  asset: TrackAsset,
  role: z.string(),
  anchor_at: z.string(),
  anchor_close: z.number().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  sign_close: z.number().nullable().optional(),
  latest_close: z.number().nullable().optional(),
  latest_date: z.string().nullable().optional(),
  // 小数. 0.15 = +15%. 见 features/track/format.formatPct.
  pct_since_discovery: z.number().nullable().optional(),
  pct_since_sign: z.number().nullable().optional(),
  source: z.string().nullable().optional(),
  bars: z.array(TrackBar).default([]),
});
export type Track = z.infer<typeof Track>;

const SignalTrackResponse = z.object({
  signal_id: z.string().uuid(),
  tracks: z.array(Track).default([]),
});
export type SignalTrackResponse = z.infer<typeof SignalTrackResponse>;

const CommitmentTrackResponse = z.object({
  commitment_id: z.string().uuid(),
  signed_at: z.string().nullable().optional(),
  thesis_asset: z.string().nullable().optional(),
  tracks: z.array(Track).default([]),
});
export type CommitmentTrackResponse = z.infer<typeof CommitmentTrackResponse>;

/** 原始日线 (OHLCV); 标的专页全程曲线用. */
export const PriceBar = z.object({
  date: z.string(),
  open: z.number().nullable().optional(),
  high: z.number().nullable().optional(),
  low: z.number().nullable().optional(),
  close: z.number(),
  volume: z.number().nullable().optional(),
});
export type PriceBar = z.infer<typeof PriceBar>;

const AssetPricesResponse = z.object({
  asset: TrackAsset,
  price_status: z.string().optional(),
  price_synced_at: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  bars: z.array(PriceBar).default([]),
});
export type AssetPricesResponse = z.infer<typeof AssetPricesResponse>;

/** 反查: 我碰过这只标的的每条命题 (信号 / 承诺). */
export const AssetThesis = z.object({
  kind: z.enum(["signal", "commitment"]),
  signal_id: z.string().uuid(),
  captured_at: z.string(),
  anchor_at: z.string(),
  role: z.string(),
  rationale: z.string().nullable().optional().default(""),
  summary: z.string().nullable().optional().default(""),
  commitment_id: z.string().nullable().optional(),
  commitment_status: z.string().nullable().optional(),
  signed_at: z.string().nullable().optional(),
  action: z.string().nullable().optional(),
});
export type AssetThesis = z.infer<typeof AssetThesis>;

const AssetThesesResponse = z.object({
  asset: TrackAsset,
  theses: z.array(AssetThesis).default([]),
});
export type AssetThesesResponse = z.infer<typeof AssetThesesResponse>;

// ───── Calls ─────

/** 某信号指向的全部标的 + 发现锚点后的走势. 无签字日字段. */
export async function getSignalTrack(signalId: string): Promise<SignalTrackResponse> {
  const json = await api.get(`v1/signals/${signalId}/track`).json();
  return SignalTrackResponse.parse(json);
}

/** 某承诺指向的标的走势, 额外叠加签字日锚点 (最高价值入口). */
export async function getCommitmentTrack(commitmentId: string): Promise<CommitmentTrackResponse> {
  const json = await api.get(`v1/commitments/${commitmentId}/track`).json();
  return CommitmentTrackResponse.parse(json);
}

/** 标的全程原始日线. from/to 为 YYYY-MM-DD; 省略 = 服务端默认窗口. */
export async function getAssetPrices(
  assetId: string,
  range?: { from?: string; to?: string },
): Promise<AssetPricesResponse> {
  const searchParams: Record<string, string> = {};
  if (range?.from) searchParams.from = range.from;
  if (range?.to) searchParams.to = range.to;
  const json = await api.get(`v1/assets/${assetId}/prices`, { searchParams }).json();
  return AssetPricesResponse.parse(json);
}

/** 标的专页反查: 列出碰过它的每条命题. */
export async function getAssetTheses(assetId: string): Promise<AssetThesesResponse> {
  const json = await api.get(`v1/assets/${assetId}/theses`).json();
  return AssetThesesResponse.parse(json);
}

// ───── 帮手 ─────

/** 可追踪 = 有日线且非 untrackable. UI 据此决定画曲线还是显示"无法追踪". */
export function isTrackable(track: Pick<Track, "asset" | "bars">): boolean {
  return track.asset.status !== "untrackable" && track.bars.length > 0;
}

// ───── Hub 聚合 (标的追踪着陆页) ─────

/**
 * Hub「关联标的」一项: 标的 meta + 行情状态 + 最新价 + 发现至今涨跌 + 命题数.
 * 不带日线 (digest, 不画 sparkline; 完整曲线在 /asset/[id] 专页).
 * untrackable 或未定价时 latest_close/latest_date/pct_since_discovery 缺省 (omitempty).
 */
export const TrackOverviewAsset = z.object({
  asset: TrackAsset,
  price_status: z.string().optional().default(""),
  price_synced_at: z.string().nullable().optional(),
  last_touched: z.string(),
  thesis_count: z.number().default(0),
  latest_close: z.number().nullable().optional(),
  latest_date: z.string().nullable().optional(),
  // 小数. 0.15 = +15%. 见 features/track/format.formatPct.
  pct_since_discovery: z.number().nullable().optional(),
});
export type TrackOverviewAsset = z.infer<typeof TrackOverviewAsset>;

/** Hub「信号」行内轻量标的标签 (无 id, 仅展示; 整行下钻到 /signal/[id]). */
export const TrackOverviewSignalAsset = z.object({
  canonical: z.string(),
  name: z.string(),
  market: z.string(),
  status: z.string(),
});
export type TrackOverviewSignalAsset = z.infer<typeof TrackOverviewSignalAsset>;

/** Hub「信号」一项: 最近带标的的信号 + 其归一后的标的. */
export const TrackOverviewSignal = z.object({
  signal_id: z.string().uuid(),
  captured_at: z.string(),
  summary: z.string().optional().default(""),
  assets: z.array(TrackOverviewSignalAsset).default([]),
});
export type TrackOverviewSignal = z.infer<typeof TrackOverviewSignal>;

/** Hub「订阅信息」一项: 最新订阅推文. summary 空时 UI 用 text 兜底; relevance 可做角标. */
export const TrackOverviewTweet = z.object({
  id: z.string(),
  handle: z.string(),
  text: z.string().optional().default(""),
  summary: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  tags: z.array(z.string()).nullable().optional(),
  // 相关度 (小数 0..1); 缺省 = 未分类推文.
  relevance: z.number().nullable().optional(),
  tweet_created_at: z.string(),
});
export type TrackOverviewTweet = z.infer<typeof TrackOverviewTweet>;

/** 标的追踪 Hub 着陆页: 一次取齐三段 (各按"最新"倒序). */
export const TrackOverview = z.object({
  assets: z.array(TrackOverviewAsset).default([]),
  signals: z.array(TrackOverviewSignal).default([]),
  tweets: z.array(TrackOverviewTweet).default([]),
});
export type TrackOverview = z.infer<typeof TrackOverview>;

/** GET /v1/track/overview —— Hub 三段聚合 (user-scoped, Bearer). */
export async function getTrackOverview(limit = 20): Promise<TrackOverview> {
  const json = await api
    .get("v1/track/overview", { searchParams: { limit: String(limit) } })
    .json();
  return TrackOverview.parse(json);
}
