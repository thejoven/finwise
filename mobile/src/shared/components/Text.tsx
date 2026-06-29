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

// ───────── Display (系统字体 SF Pro · 中文 fallback PingFang) ─────────
//
// 英文标题默认走系统字体 (iOS = SF Pro, Android = Roboto), 中文自动 fallback 到
// 系统中文字体. 唯一例外: AlphaX 品牌字 / masthead 报头副线传 `serif`, 回到
// Playfair Display —— 那是刻意保留的"报刊感"招牌字, 不随正文一起换。

export interface DisplayProps extends TextProps {
  size?: number;
  italic?: boolean;
  weight?: "regular" | "bold";
  /** 招牌字 (AlphaX / 报头副线) 用 Playfair Display 衬线体; 其余一律系统字体. */
  serif?: boolean;
}

export function Display({
  children,
  style,
  size = 28,
  italic = false,
  weight = "bold",
  serif = false,
  allowFontScaling = false, // 大标题不缩放
  ...props
}: DisplayProps) {
  const serifFamily =
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
          // serif: Playfair 用文件名定字重/字形; 系统态: 用 fontWeight + fontStyle.
          ...(serif
            ? { fontFamily: serifFamily }
            : { fontWeight: weight === "bold" ? "700" : "400", fontStyle: italic ? "italic" : "normal" }),
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

// ───────── Serif Body → 系统字体 (SF Pro · 中文 fallback PingFang) ─────────
//
// 正文/对话/引文的英文走系统字体 SF Pro (历史上是 Source Serif 4 衬线, 2026-06-28
// 改为苹果系统字体); 中文照旧 fallback 系统中文字体. 组件名 Serif 保留以免动 200+ 调用点。

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
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
      style={[
        {
          // 不设 fontFamily — 让系统选 SF Pro (iOS) / Roboto (Android).
          fontWeight: weight === "semibold" ? "600" : "400",
          fontStyle: italic ? "italic" : "normal",
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

export function Sans({
  children,
  style,
  size = 13,
  weight = "400",
  maxFontSizeMultiplier = 1.2, // 系统大字号下封顶, 防紧凑 chrome/邮票字溢出 (见 02-checklist §6.5)
  ...props
}: SansProps) {
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
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

export function Mono({
  children,
  style,
  size = 11,
  weight = "regular",
  maxFontSizeMultiplier = 1.2, // 同 Sans — 时间戳/邮票数字也封顶, 防溢出
  ...props
}: MonoProps) {
  return (
    <RNText
      maxFontSizeMultiplier={maxFontSizeMultiplier}
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
