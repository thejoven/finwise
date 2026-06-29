/**
 * iOS HIG 字号阶梯 — 用作"普通"字号. 报刊感的大字 (Display) 不限于此表.
 */
export const fontSize = {
  caption2: 11,
  caption1: 12,
  footnote: 13,
  subhead: 15,
  callout: 16,
  body: 17,
  headline: 17,
  title3: 20,
  title2: 22,
  title1: 28,
  largeTitle: 34,
} as const;

export type FontSizeToken = keyof typeof fontSize;

/**
 * 字体文件名映射. 必须和 assets/fonts/ 里的实际文件名一致.
 *
 * 英文正文/标题 (Display 非 serif 态 / Serif / 输入框) 走系统字体 (iOS = SF Pro,
 * Android = Roboto), **不在此表里** —— 不设 fontFamily 即可. 见 Text.tsx.
 * 这里只留三类必须 bundle 的字体:
 *   · display* (Playfair Display) —— 仅 AlphaX 品牌字 / masthead 报头副线还在用 (`<Display serif>`)
 *   · cjk*     (Noto Serif SC)    —— 报名"财知"等中文报刊字
 *   · mono*    (JetBrains Mono)   —— 数字 / ID / 时间戳
 */
export const fontFamily = {
  displayRegular: "PlayfairDisplay-Regular",
  displayItalic: "PlayfairDisplay-Italic",
  displayBold: "PlayfairDisplay-Bold",
  displayBoldItalic: "PlayfairDisplay-BoldItalic",

  cjkRegular: "NotoSerifSC-Regular",
  cjkBold: "NotoSerifSC-Bold",

  monoRegular: "JetBrainsMono-Regular",
  monoMedium: "JetBrainsMono-Medium",
} as const;

export type FontFamilyToken = keyof typeof fontFamily;
