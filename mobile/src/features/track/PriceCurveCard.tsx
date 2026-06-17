/**
 * PriceCurveCard —— 可复用"标的表现"卡: 顶部醒目累计涨跌 + 锚定曲线 + 数据截至脚注.
 * 承诺页 hero / 标的专页全程曲线共用. 纯展示, 文案由调用方按语言预解析后传入.
 *
 * 颜色: 大数字 + 曲线统一按 primaryPct 方向取色 (红涨绿跌).
 */

import { StyleSheet, View } from "react-native";

import { Mono, Sans, TapEffect } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import type { TrackBar } from "@/core/api/track";

import { PriceCurve, type CurveAnchor } from "./PriceCurve";
import { changeColor, formatPct } from "./format";

interface PriceCurveCardProps {
  bars: TrackBar[];
  anchors?: CurveAnchor[];
  baseline?: number | null;
  /** 顶部大涨跌的标签 (如"签字至今"). */
  primaryLabel: string;
  primaryPct: number | null;
  /** 次要一行 (如"发现至今"); 省略则不显示. */
  secondaryLabel?: string;
  secondaryPct?: number | null;
  /** 收盘一行 (如"发现时 73.40 · 最新 84.40"). */
  closesLine?: string | null;
  /** 数据截至脚注 (来源 + as-of 日, §7 数据出处). */
  asOf?: string | null;
  onPress?: () => void;
  height?: number;
}

export function PriceCurveCard({
  bars,
  anchors,
  baseline = null,
  primaryLabel,
  primaryPct,
  secondaryLabel,
  secondaryPct,
  closesLine,
  asOf,
  onPress,
  height,
}: PriceCurveCardProps) {
  const c = useThemeColors();
  const color = changeColor(primaryPct, c);

  const inner = (
    <>
      <View style={styles.head}>
        <Mono size={9} style={styles.stamp}>
          {primaryLabel}
        </Mono>
        <Mono size={32} style={[styles.big, { color }]}>
          {formatPct(primaryPct)}
        </Mono>
        {secondaryLabel ? (
          <View style={styles.secondary}>
            <Mono size={10} style={styles.secondaryLabel}>
              {secondaryLabel}
            </Mono>
            <Mono size={11} style={[styles.secondaryPct, { color: changeColor(secondaryPct, c) }]}>
              {formatPct(secondaryPct)}
            </Mono>
          </View>
        ) : null}
      </View>

      <PriceCurve bars={bars} color={color} anchors={anchors} baseline={baseline} height={height} />

      {closesLine ? (
        <Mono size={10} style={styles.closes}>
          {closesLine}
        </Mono>
      ) : null}
      {asOf ? (
        <Mono size={9} style={styles.asOf}>
          {asOf}
        </Mono>
      ) : null}
    </>
  );

  if (onPress) {
    return (
      <TapEffect style={styles.card} pressedStyle={styles.pressed} onPress={onPress}>
        {inner}
      </TapEffect>
    );
  }
  return <View style={styles.card}>{inner}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  pressed: {
    backgroundColor: theme.color.paper3,
  },
  head: {
    gap: 2,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  big: {
    letterSpacing: 0.5,
    lineHeight: 38,
  },
  secondary: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  secondaryLabel: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  secondaryPct: {
    letterSpacing: 0.5,
  },
  closes: {
    color: theme.color.muted,
    letterSpacing: 0.5,
    marginTop: theme.spacing.xs,
  },
  asOf: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
});
