/**
 * 圆角阶梯.
 *   none = 报刊风按钮 (签字、承诺书)
 *   md   = 标准按钮、输入框
 *   lg   = 大卡片
 *   full = 头像、徽章
 */
export const radius = {
  none: 0,
  sm: 6,
  md: 10,
  lg: 14,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radius;
