/**
 * charts.ts — 给 react-native-chart-kit 配的"报刊风"统一 chartConfig.
 *
 * Chartjs 默认色板偏商业蓝绿; 我们覆盖为 ink/red/muted 三色加 paper2 背景,
 * 与 inbox / refinement 屏整体一致 (报刊感, 不像 dashboard).
 */

import type { ChartConfig } from "react-native-chart-kit/dist/HelperTypes";

import { theme } from "@/core/theme";

/** 把 hex 转 rgba 字符串, 给 chartConfig.color 用 */
function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** 通用报刊风 chartConfig — 黑墨主线, 米色背景, 小字 mono label */
export const baseChartConfig: ChartConfig = {
  backgroundColor: theme.color.paper,
  backgroundGradientFrom: theme.color.paper,
  backgroundGradientTo: theme.color.paper,
  decimalPlaces: 0,
  color: (opacity = 1) => hexToRgba(theme.color.ink, opacity),
  labelColor: (opacity = 1) => hexToRgba(theme.color.muted, opacity),
  propsForBackgroundLines: {
    stroke: theme.color.ruleSoft,
    strokeDasharray: "2 4",
  },
  propsForLabels: {
    fontFamily: "JetBrainsMono-Regular",
    fontSize: 9,
  },
  propsForDots: {
    r: "3",
    strokeWidth: "1.5",
    stroke: theme.color.ink,
  },
};

/** 4 维评分对应固定颜色; 复用给 line / bar / pie 让用户视觉绑定 */
export const DIMENSION_COLORS = {
  focus: theme.color.ink,
  depth: theme.color.red,
  breadth: theme.color.muted,
  execution: theme.color.green,
} as const;

export type DimensionKey = keyof typeof DIMENSION_COLORS;

/** 给 PieChart 用的色板: 7 色循环 (top tag 通常 ≤ 8 个) */
export const PIE_PALETTE: string[] = [
  theme.color.ink,
  theme.color.red,
  theme.color.green,
  theme.color.ink2,
  theme.color.muted,
  theme.color.ink3,
  theme.color.muted2,
];

export { hexToRgba };
