/**
 * 色板 — 严格按 references/04-cross-platform-design.md § 1.
 * 不要在组件里硬编码 #XXXXXX, 全部走 theme.color.*.
 */

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
