/**
 * Theme entry point.
 *
 * 仍是静态 import(无 Context / styled-components): token 来源清晰、性能好.
 * 暗黑模式不靠切换 theme 对象, 而是把 `color` 的每个 token 做成 DynamicColorIOS
 *   动态色(见 ./colors), iOS 原生按外观解析 —— `theme.color.X` 自动随明暗切换.
 *
 * 只有"必须拿真 hex 字符串"的消费方(chart-kit / blur tint 等)走 `useThemeColors()`,
 *   它按当前外观返回纯 hex 调色板, 并在外观变化时触发重渲染.
 */
import { useColorScheme } from "react-native";

import { colors, resolveColors } from "./colors";
import { spacing } from "./spacing";
import { radius } from "./radius";
import { fontSize, fontFamily } from "./typography";

export const theme = {
  color: colors,
  spacing,
  radius,
  fontSize,
  fontFamily,
} as const;

export type Theme = typeof theme;

/**
 * 当前外观对应的纯 hex 调色板. 给不能吃不透明动态色的消费方用(图表 / blur tint).
 * useColorScheme 订阅 Appearance 变更, 而 Appearance.setColorScheme 会同步触发 change,
 * 所以切偏好 / 系统翻转时, 用到本 hook 的组件都会重渲染.
 */
export function useThemeColors() {
  return resolveColors(useColorScheme());
}

export { lightColors, darkColors, resolveColors, projectSwatches } from "./colors";

export type { ColorToken } from "./colors";
export type { SpacingToken } from "./spacing";
export type { RadiusToken } from "./radius";
export type { FontSizeToken, FontFamilyToken } from "./typography";
