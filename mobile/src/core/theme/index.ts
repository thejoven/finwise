/**
 * Theme entry point.
 *
 * Imported as a static module — no Context, no styled-components, no provider.
 * Phase 1 only supports light; when dark lands, swap to a `useTheme()` hook
 * that reads useColorScheme. See references/04 § 5 for the migration plan.
 */
import { lightColors } from "./colors";
import { spacing } from "./spacing";
import { radius } from "./radius";
import { fontSize, fontFamily } from "./typography";

export const theme = {
  color: lightColors,
  spacing,
  radius,
  fontSize,
  fontFamily,
} as const;

export type Theme = typeof theme;

export type { ColorToken } from "./colors";
export type { SpacingToken } from "./spacing";
export type { RadiusToken } from "./radius";
export type { FontSizeToken, FontFamilyToken } from "./typography";
