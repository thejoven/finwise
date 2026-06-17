/**
 * React Query hooks · 标的追踪.
 *
 * 价格是日线 (每日 poller 补一根), 故 staleTime 给得大 (5min): 同一标的/信号在
 * 降噪列表 + 详情 + 归档间反复出现, 共享缓存不重复打后端.
 */

import { useQuery } from "@tanstack/react-query";

import { byIdQuery } from "@/core/api/query";
import {
  getAssetPrices,
  getAssetTheses,
  getCommitmentTrack,
  getSignalTrack,
  getTrackOverview,
} from "@/core/api/track";

const PRICE_STALE = 5 * 60_000;

/**
 * 某信号的标的走势. opts.enabled 让列表行可懒加载 (默认 true).
 * id 缺省时 byIdQuery 已置 enabled:false, 这里再 AND 上调用方的开关.
 */
export function useSignalTrack(signalId: string | undefined, opts?: { enabled?: boolean }) {
  const base = byIdQuery(["track", "signal"], signalId, getSignalTrack);
  return useQuery({
    ...base,
    enabled: base.enabled && (opts?.enabled ?? true),
    staleTime: PRICE_STALE,
  });
}

/** 某承诺的标的走势 (含签字日锚点). */
export function useCommitmentTrack(commitmentId: string | undefined) {
  return useQuery({
    ...byIdQuery(["track", "commitment"], commitmentId, getCommitmentTrack),
    staleTime: PRICE_STALE,
  });
}

/** 标的全程日线 (专页全曲线). */
export function useAssetPrices(assetId: string | undefined) {
  return useQuery({
    ...byIdQuery(["track", "asset", "prices"], assetId, (id) => getAssetPrices(id)),
    staleTime: PRICE_STALE,
  });
}

/** 标的反查命题 (专页档案). */
export function useAssetTheses(assetId: string | undefined) {
  return useQuery({
    ...byIdQuery(["track", "asset", "theses"], assetId, getAssetTheses),
    staleTime: PRICE_STALE,
  });
}

// ───────────────────────── Hub 着陆页: 三段聚合 ─────────────────────────

/**
 * useTrackOverview — 标的追踪 Hub 数据源. 一次 GET /v1/track/overview 取齐
 * 关联标的 / 信号 / 订阅推文三段 (各按"最新"倒序). 后端已聚合, 客户端不再翻页扫信号.
 */
export function useTrackOverview(limit = 20) {
  return useQuery({
    queryKey: ["track", "overview", limit],
    queryFn: () => getTrackOverview(limit),
    staleTime: PRICE_STALE,
  });
}
