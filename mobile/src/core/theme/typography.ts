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
 * Text 组件 (Display/Serif/Mono) 引用这些 key, 不裸写字符串.
 */
export const fontFamily = {
  displayRegular: "PlayfairDisplay-Regular",
  displayItalic: "PlayfairDisplay-Italic",
  displayBold: "PlayfairDisplay-Bold",
  displayBoldItalic: "PlayfairDisplay-BoldItalic",

  serifRegular: "SourceSerif4-Regular",
  serifItalic: "SourceSerif4-Italic",
  serifSemibold: "SourceSerif4-SemiBold",

  cjkRegular: "NotoSerifSC-Regular",
  cjkBold: "NotoSerifSC-Bold",

  monoRegular: "JetBrainsMono-Regular",
  monoMedium: "JetBrainsMono-Medium",
} as const;

export type FontFamilyToken = keyof typeof fontFamily;
