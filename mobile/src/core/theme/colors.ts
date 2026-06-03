/**
 * 色板 — 严格按 references/04-cross-platform-design.md § 1.
 * 不要在组件里硬编码 #XXXXXX, 全部走 theme.color.*.
 *
 * 暗黑模式: 每个 token 用 DynamicColorIOS({light,dark}) 包成"动态色", 由 iOS 原生
 *   按当前外观(浅/深)逐帧解析 —— 全 App 的 `theme.color.X` 因此自动跟随明暗切换,
 *   样式无需改动. 偏好(光亮/暗黑/跟随系统)由 `Appearance.setColorScheme` 驱动,
 *   见 `@/core/theme/store`.
 *
 * 非 iOS: DynamicColorIOS 在原生侧是会 throw 的桩, 故守卫 Platform 后退回 light hex
 *   —— Android 当前阶段只跑 light.
 *
 * 需要"真 hex 字符串"的消费方(chart-kit 图表 / blur tint / scrim 等)不能吃不透明的
 *   动态色, 走 `resolveColors(scheme)` 拿纯 hex; 见 `useThemeColors()`.
 */

import { DynamicColorIOS, Platform, type ColorValue } from "react-native";

export const lightColors = {
  paper: "#ffffff",
  paper2: "#fafaf7",
  paper3: "#f3f1ec",
  paper4: "#ebe9e2",
  paperPressed: "#e8e6e0",

  ink: "#0a0a0a",
  ink2: "#2a2a2a",
  ink3: "#4a4a4a",

  muted: "#6b6b6b",
  muted2: "#999999",

  rule: "#d6d4ce",
  ruleSoft: "#e8e6e0",

  red: "#a8201a",
  redSoft: "#fce8e6",
  green: "#2e5e3a",

  highlight: "#fff4a8",
} as const;

export type ColorToken = keyof typeof lightColors;

/**
 * 暗色调色板 — 倒置的"墨落于纸": 暖近黑纸 + 暖白墨 + 提亮的红/绿(深色底需要更亮才
 * 够对比). paper→paper4 仍单调变浅以维持层级. redSoft/highlight 是文字底色, 故倒成
 * 暗色调而非浅色. 键名必须与 lightColors 完全一致(satisfies 强校验).
 */
export const darkColors = {
  paper: "#14110c",
  paper2: "#1b1813",
  paper3: "#221e18",
  paper4: "#2a251e",
  paperPressed: "#322c24",

  ink: "#f5f1e8",
  ink2: "#d8d2c4",
  ink3: "#b3ac9c",

  muted: "#8f897c",
  muted2: "#6f6a5f",

  rule: "#3a342b",
  ruleSoft: "#2a251e",

  red: "#e0635c",
  redSoft: "#3a1f1d",
  green: "#6fae7e",

  highlight: "#5c4a12",
} satisfies Record<ColorToken, string>;

/**
 * iOS → DynamicColorIOS(随外观解析); 其他平台 → light hex.
 * 守卫 Platform: 非 iOS 的 DynamicColorIOS 是 throw 桩, 模块加载即崩.
 */
function dynamicColor(light: string, dark: string): ColorValue {
  return Platform.OS === "ios" ? DynamicColorIOS({ light, dark }) : light;
}

/**
 * 全 App 走的色板. 值是 ColorValue —— iOS 上随明暗自动切换, 故 614 处 `theme.color.X`
 * 用法都不必改. (cast 保证非 optional, 不给 614 处引入 `| undefined`.)
 */
export const colors = Object.fromEntries(
  (Object.keys(lightColors) as ColorToken[]).map((key) => [
    key,
    dynamicColor(lightColors[key], darkColors[key]),
  ]),
) as Record<ColorToken, ColorValue>;

/** 纯 hex 调色板 — 给只能吃字符串的消费方(图表 / blur tint / scrim). */
export function resolveColors(scheme: "light" | "dark" | null | undefined) {
  return scheme === "dark" ? darkColors : lightColors;
}

/**
 * 项目强调色候选 —— 用户为分类挑选的色块. 这些是会被持久化、且要做相等比较(color === c)
 * 的"真 hex 字符串", 故不走 DynamicColorIOS 动态色(动态色无法 === 比较, 也不应随明暗变).
 * 明暗两态共用同一组.
 */
export const projectSwatches = [
  "#a8201a",
  "#2e5e3a",
  "#1f4e79",
  "#7a4f01",
  "#5a2a82",
  "#2a2a2a",
] as const;
