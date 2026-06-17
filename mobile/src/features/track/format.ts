/**
 * 标的追踪的涨跌口径 + 配色 —— 全功能共用, 收口到一处避免各处重写.
 *
 * **红涨绿跌** (A股惯例, 本产品默认; 见记忆 signal-rec-and-target-tracking-dev).
 * pct_since_* 是后端给的**小数** (0.15 = +15%), 这里统一 × 100 再渲染.
 */

import { resolveColors } from "@/core/theme";

type Palette = ReturnType<typeof resolveColors>;

/** 涨跌方向 → 报刊色. 涨=红, 跌=绿; 0 / 缺省 → muted (不强行着色). */
export function changeColor(pct: number | null | undefined, c: Palette): string {
  if (pct == null || pct === 0) return c.muted;
  return pct > 0 ? c.red : c.green;
}

/** 小数涨跌幅 → "+15.0%" / "−4.5%" / "0.0%"; null → "—" (无数据, 不编造). */
export function formatPct(pct: number | null | undefined): string {
  if (pct == null || Number.isNaN(pct)) return "—";
  const v = pct * 100;
  const sign = v > 0 ? "+" : v < 0 ? "−" : "";
  return `${sign}${Math.abs(v).toFixed(1)}%`;
}

/** 收盘价 → 两位小数. 不带货币符 (报刊克制 + 多市场混排). null → "—". */
export function formatClose(v: number | null | undefined): string {
  if (v == null || Number.isNaN(v)) return "—";
  return v.toFixed(2);
}

/** 区间首→末的小数涨跌幅 (标的专页全程曲线用); 不足两点 → null. */
export function rangePct(closes: number[]): number | null {
  if (closes.length < 2) return null;
  const first = closes[0]!;
  const last = closes[closes.length - 1]!;
  if (first === 0) return null;
  return (last - first) / first;
}
