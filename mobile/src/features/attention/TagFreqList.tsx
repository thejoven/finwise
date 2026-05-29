/**
 * TagFreqList — 信号领域 top N, Mono 计数 + Serif tag 名.
 *
 * 视觉:
 *   ● 5  HBM / 半导体
 *   ●●● 3  Hyperliquid
 *   ●●   2  华为韬定律
 *
 * "● 数量" 是简化版的横向 bar — 跟报刊风一致, 不引 chart 库.
 */

import { StyleSheet, View } from "react-native";

import { Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  items: Array<{ tag: string; count: number }>;
}

export function TagFreqList({ items }: Props) {
  if (items.length === 0) {
    return (
      <Serif size={12} italic style={styles.empty}>
        近期没有可统计的标签 — 完成几次五轮追问之后会显示在这里.
      </Serif>
    );
  }
  const maxCount = items.reduce((acc, t) => (t.count > acc ? t.count : acc), 1);

  return (
    <View style={styles.list}>
      {items.map((t) => {
        const dots = "●".repeat(Math.max(1, Math.round((t.count / maxCount) * 5)));
        return (
          <View key={t.tag} style={styles.row}>
            <Mono size={11} style={styles.dots}>
              {dots.padEnd(5, " ")}
            </Mono>
            <Mono size={11} style={styles.count}>
              {t.count}
            </Mono>
            <Serif size={13} style={styles.tag} numberOfLines={1}>
              {t.tag}
            </Serif>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  list: {
    gap: theme.spacing.sm,
  },
  row: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  dots: {
    color: theme.color.ink,
    width: 80,
    letterSpacing: 2,
  },
  count: {
    color: theme.color.muted,
    width: 24,
    textAlign: "right",
  },
  tag: {
    flex: 1,
    color: theme.color.ink2,
  },
  empty: {
    color: theme.color.muted,
    lineHeight: 22,
  },
});
