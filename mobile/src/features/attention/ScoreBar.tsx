/**
 * ScoreBar — 大 Mono 数字 + 横向 ░▓ 进度条.
 *
 * 视觉:
 *    82                ← Display 大数字
 *   ─── 专注 ───       ← Mono 标签
 *   ▓▓▓▓▓▓▓▓░░ 82/100
 */

import { StyleSheet, View } from "react-native";

import { Display, Mono } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  label: string;
  score: number; // 0-100
}

const BAR_LENGTH = 20;

export function ScoreBar({ label, score }: Props) {
  const filled = Math.round((score / 100) * BAR_LENGTH);
  const empty = BAR_LENGTH - filled;
  const bar = "▓".repeat(filled) + "░".repeat(empty);

  return (
    <View style={styles.root}>
      <View style={styles.row}>
        <Display size={28} style={styles.num}>
          {score}
        </Display>
        <Mono size={9} style={styles.label}>
          {label}
        </Mono>
      </View>
      <Mono size={11} style={styles.bar}>
        {bar}
      </Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  num: {
    color: theme.color.ink,
    lineHeight: 30,
  },
  label: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  bar: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
});
