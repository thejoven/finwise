/**
 * Haptics wrapper.
 *
 * 项目里**只暴露**三种触感, 按 references/06-haptic-grammar.md § 2:
 *   - selection: 切 Tab / List 选择 / 五轮追问选项
 *   - light: 录入按钮按下 / ActionSheet 弹起
 *   - medium: 签字按下 / 退出条件触发 / "看见自己" 时刻
 *
 * 故意**不**暴露:
 *   - heavy / Success / Warning / Error — 违反"沉默优于发声"
 *   - notificationAsync — 上面三个都不暴露
 *
 * 平台兜底: expo-haptics 在 Android / Web 上自动降级或 no-op, 不需要 Platform.OS.
 */

import * as Haptics from "expo-haptics";

export const haptic = {
  selection: () => Haptics.selectionAsync(),
  light: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light),
  medium: () => Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium),
} as const;
