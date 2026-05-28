/**
 * 4 个字体组件: Display / Serif / Sans / Mono.
 *
 * 规则: 项目里**任何文字**都从这 4 个组件出. 不允许直接用 RN 的 <Text>.
 * 这条规则由人 review 时把关 (没法用 ESLint 100% 强制, 因为有时确实需要 RN Text 的 native API).
 *
 * 字号 / 行高 / 字距按 references/07-typography.md § 4 的封装.
 */

import { Text as RNText, type TextProps } from "react-native";
import { theme } from "@/core/theme";

// ───────── Display (Playfair Display + 中文 fallback) ─────────

export interface DisplayProps extends TextProps {
  size?: number;
  italic?: boolean;
  weight?: "regular" | "bold";
}

export function Display({
  children,
  style,
  size = 28,
  italic = false,
  weight = "bold",
  allowFontScaling = false, // 大标题不缩放
  ...props
}: DisplayProps) {
  const family =
    italic && weight === "bold"
      ? theme.fontFamily.displayBoldItalic
      : italic
        ? theme.fontFamily.displayItalic
        : weight === "bold"
          ? theme.fontFamily.displayBold
          : theme.fontFamily.displayRegular;

  return (
    <RNText
      allowFontScaling={allowFontScaling}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: size * 1.15,
          letterSpacing: -size * 0.02,
          color: theme.color.ink,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

// ───────── Serif Body (Source Serif 4 + 中文 fallback) ─────────

export interface SerifProps extends TextProps {
  size?: number;
  italic?: boolean;
  weight?: "regular" | "semibold";
}

export function Serif({
  children,
  style,
  size = 14,
  italic = false,
  weight = "regular",
  maxFontSizeMultiplier = 1.2,
  ...props
}: SerifProps) {
  const family = italic
    ? theme.fontFamily.serifItalic
    : weight === "semibold"
      ? theme.fontFamily.serifSemibold
      : theme.fontFamily.serifRegular;

  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        {
          fontFamily: family,
          fontSize: size,
          lineHeight: size * 1.5,
          color: theme.color.ink2,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

// ───────── Sans (系统字体, 不 bundle) ─────────

export interface SansProps extends TextProps {
  size?: number;
  weight?: "400" | "500" | "600" | "700";
}

export function Sans({ children, style, size = 13, weight = "400", ...props }: SansProps) {
  return (
    <RNText
      style={[
        {
          // 故意不设 fontFamily — 让系统选 SF Pro (iOS) / Roboto (Android)
          fontSize: size,
          fontWeight: weight,
          lineHeight: size * 1.4,
          color: theme.color.ink,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}

// ───────── Mono (JetBrains Mono) ─────────

export interface MonoProps extends TextProps {
  size?: number;
  weight?: "regular" | "medium";
}

export function Mono({ children, style, size = 11, weight = "regular", ...props }: MonoProps) {
  return (
    <RNText
      style={[
        {
          fontFamily:
            weight === "medium" ? theme.fontFamily.monoMedium : theme.fontFamily.monoRegular,
          fontSize: size,
          fontVariant: ["tabular-nums"],
          color: theme.color.ink2,
        },
        style,
      ]}
      {...props}
    >
      {children}
    </RNText>
  );
}
