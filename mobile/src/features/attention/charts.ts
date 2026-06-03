/**
 * charts.ts — 给 react-native-chart-kit 配的"报刊风"统一 chartConfig.
 *
 * Chartjs 默认色板偏商业蓝绿; 我们覆盖为 ink/red/muted 三色加 paper2 背景,
 * 与 inbox / refinement 屏整体一致 (报刊感, 不像 dashboard).
 *
 * 暗黑模式: chart-kit 的颜色字段类型是 string / (opacity)=>string, 吃不了不透明的
 *   DynamicColorIOS 动态色(还会被喂进 SVG <Stop> 渐变). 故这里都是**工厂函数**,
 *   入参为当前外观的纯 hex 调色板 (resolveColors 的返回, 由 useThemeColors 提供).
 */

import type { ChartConfig } from "react-native-chart-kit/dist/HelperTypes";

import { resolveColors } from "@/core/theme";

/** 当前外观的纯 hex 调色板. */
type Palette = ReturnType<typeof resolveColors>;

/** 把 hex 转 rgba 字符串, 给 chartConfig.color 用 */
function hexToRgba(hex: string, opacity: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${opacity})`;
}

/** 通用报刊风 chartConfig — 黑墨主线, 米色背景, 小字 mono label. */
export function makeBaseChartConfig(c: Palette): ChartConfig {
  return {
    backgroundColor: c.paper,
    backgroundGradientFrom: c.paper,
    backgroundGradientTo: c.paper,
    decimalPlaces: 0,
    color: (opacity = 1) => hexToRgba(c.ink, opacity),
    labelColor: (opacity = 1) => hexToRgba(c.muted, opacity),
    propsForBackgroundLines: {
      stroke: c.ruleSoft,
      strokeDasharray: "2 4",
    },
    propsForLabels: {
      fontFamily: "JetBrainsMono-Regular",
      fontSize: 9,
    },
    propsForDots: {
      r: "3",
      strokeWidth: "1.5",
      stroke: c.ink,
    },
  };
}

/** 4 维评分对应固定颜色; 复用给 line / bar / pie 让用户视觉绑定 */
export function makeDimensionColors(c: Palette) {
  return {
    focus: c.ink,
    depth: c.red,
    breadth: c.muted,
    execution: c.green,
  } as const;
}

export type DimensionKey = "focus" | "depth" | "breadth" | "execution";

/** 给 PieChart 用的色板: 7 色循环 (top tag 通常 ≤ 8 个) */
export function makePiePalette(c: Palette): string[] {
  return [c.ink, c.red, c.green, c.ink2, c.muted, c.ink3, c.muted2];
}

export { hexToRgba };
