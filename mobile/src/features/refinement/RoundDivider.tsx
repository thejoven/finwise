/**
 * RoundDivider — 已答轮之间的报刊式分隔.
 *
 * 视觉:   ── · R2 · ──
 *
 *   左右各一段 short hairline rule, 中间 Mono 9px stamp "· R2 ·".
 *   像旧报纸"卷期"/"接续"标记, 提供呼吸感. 不抢主体焦点.
 *
 * 用在 RefinementScreen 长滚动里 — 第 N 题与第 N+1 题之间放一条.
 */

import { StyleSheet, View } from "react-native";

import { Mono } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  /** 当前 round 号 (右边那一轮); divider 表示"接下来是 R{round}" */
  round: number;
}

export function RoundDivider({ round }: Props) {
  return (
    <View style={styles.row}>
      <View style={styles.rule} />
      <Mono size={9} style={styles.stamp}>
        {`· R${round} ·`}
      </Mono>
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.md,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.rule,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 3,
    textTransform: "uppercase",
  },
});
