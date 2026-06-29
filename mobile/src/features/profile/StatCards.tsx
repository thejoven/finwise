/**
 * StatCards — 个人资料统计的指标卡网格 (报刊式).
 *
 * 每张卡: 大号衬线数字 + Mono 大写小标 + 可选灰字注脚 (如「共 N」「最长 N」).
 * 三列自适应 wrap, 直角描边卡片, 与全 App 纸感统一. 纯 RN, 双路径通用.
 */

import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import type { StatsMetricsDTO } from "@/core/api/account";

export interface StatCardItem {
  key: string;
  value: number | string;
  label: string;
  note?: string;
}

/** 把后端 metrics 摊成卡片列表. 顺序: 信号 · 已推演 · 过会 · 分类 · 活跃 · 连续. */
export function useMetricCards(m: StatsMetricsDTO): StatCardItem[] {
  const { t } = useTranslation();
  return [
    { key: "signals", value: m.signals_total, label: t("profile.stats.cards.signals") },
    {
      key: "matured",
      value: m.signals_matured,
      label: t("profile.stats.cards.matured"),
      note: t("profile.stats.cards.ofTotal", { total: m.signals_total }),
    },
    {
      key: "gate",
      value: m.gate_passed,
      label: t("profile.stats.cards.gatePassed"),
      note: t("profile.stats.cards.ofTries", { total: m.gate_total }),
    },
    { key: "projects", value: m.projects, label: t("profile.stats.cards.projects") },
    {
      key: "active",
      value: m.active_days,
      label: t("profile.stats.cards.activeDays"),
    },
    {
      key: "streak",
      value: m.current_streak,
      label: t("profile.stats.cards.currentStreak"),
      note: t("profile.stats.cards.longest", { count: m.longest_streak }),
    },
  ];
}

export function StatCards({ m }: { m: StatsMetricsDTO }) {
  const items = useMetricCards(m);
  return (
    <View style={styles.grid}>
      {items.map((it) => (
        <View key={it.key} style={styles.card}>
          <Serif size={26} weight="semibold" style={styles.value}>
            {it.value}
          </Serif>
          <Mono size={9} style={styles.label}>
            {it.label}
          </Mono>
          {it.note ? (
            <Mono size={9} style={styles.note}>
              {it.note}
            </Mono>
          ) : null}
        </View>
      ))}
    </View>
  );
}

/** 资料页内嵌用的精简三联指标行 (信号 · 活跃天 · 连续天) — 一行三栏, 无卡片描边. */
export function StatStrip({ m }: { m: StatsMetricsDTO }) {
  const { t } = useTranslation();
  const cells: { value: number; label: string }[] = [
    { value: m.signals_total, label: t("profile.stats.cards.signals") },
    { value: m.active_days, label: t("profile.stats.cards.activeDays") },
    { value: m.current_streak, label: t("profile.stats.cards.currentStreak") },
  ];
  return (
    <View style={styles.strip}>
      {cells.map((c, i) => (
        <View key={c.label} style={[styles.stripCell, i > 0 && styles.stripDivider]}>
          <Serif size={22} weight="semibold" style={styles.value}>
            {c.value}
          </Serif>
          <Mono size={8} style={styles.label}>
            {c.label}
          </Mono>
        </View>
      ))}
    </View>
  );
}

const CARD_GAP = theme.spacing.sm;

const styles = StyleSheet.create({
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: CARD_GAP,
  },
  card: {
    // 三列: (100% - 2 gaps) / 3. flexBasis 用百分比, gap 由 grid 提供.
    flexBasis: "31%",
    flexGrow: 1,
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    gap: 3,
  },
  value: {
    color: theme.color.ink,
    fontVariant: ["tabular-nums"],
  },
  label: {
    color: theme.color.muted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  note: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  strip: {
    flexDirection: "row",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ruleSoft,
    paddingVertical: theme.spacing.md,
  },
  stripCell: {
    flex: 1,
    alignItems: "center",
    gap: 2,
  },
  stripDivider: {
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderLeftColor: theme.color.ruleSoft,
  },
});
