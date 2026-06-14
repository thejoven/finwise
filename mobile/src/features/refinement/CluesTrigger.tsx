/**
 * CluesTrigger — RefinementScreen header 右侧的 pill 按钮.
 *
 * 视觉: 红 diamond + "线索 · N" (N 为线索条数). loading 态显示 "线索 · …".
 * 没有线索时仍显示按钮 — 点开能看到 "未检索到" 占位, 比按钮消失对用户更可预期.
 *
 * 行为: 点击 → 父组件打开 CluesDrawer.
 */

import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Mono, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type { ResearchRecord } from "@/core/api/research";

interface Props {
  items?: ResearchRecord[];
  loading: boolean;
  onPress: () => void;
}

export function CluesTrigger({ items, loading, onPress }: Props) {
  const { t } = useTranslation();
  const total = (items ?? []).reduce((acc, r) => acc + r.results.length, 0);
  const label =
    total > 0
      ? t("refinement.clues.triggerCount", { count: total })
      : loading
        ? t("refinement.clues.triggerLoading")
        : t("refinement.clues.triggerLabel");

  return (
    <TapEffect
      style={styles.pill}
      pressedStyle={{ backgroundColor: theme.color.paper3 }}
      onPress={onPress}
    >
      <View style={styles.diamond} />
      <Mono size={10} style={styles.label}>
        {label}
      </Mono>
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 6,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  diamond: {
    width: 5,
    height: 5,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
  },
  label: {
    color: theme.color.ink,
    letterSpacing: 1.5,
  },
});
