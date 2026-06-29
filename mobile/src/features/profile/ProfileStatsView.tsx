/**
 * ProfileStatsView — 统计子页正文 (报刊式编辑面, 纯 RN).
 *
 * 编排: 报头戳记 + 标题 → 指标卡网格 → 「活跃度」点阵图 + 图例 + 连续/活跃注脚.
 * 数据走 useMyStats (与资料页内嵌指标行共享缓存). 加载/错误/空三态各有占位.
 *
 * 点阵图本就是 bespoke editorial 面 (自绘), 故整页不走原生 Form —— 与 AttentionView
 * (财知「统计」子页) 同属自绘统计面, 视觉语言一致: 红菱形戳记 + DoubleRule + Mono 小标.
 */

import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Display, DoubleRule, Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";

import { ActivityHeatmap, HeatmapLegend } from "./ActivityHeatmap";
import { StatCards } from "./StatCards";
import { useMyStats, useMonthLabels } from "./useStats";

export function ProfileStatsView() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const months = useMonthLabels();
  const { data, isLoading, isError } = useMyStats();

  return (
    <ScrollView
      contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + theme.spacing.xxxl }]}
    >
      <Mono size={9} style={styles.stamp}>
        {t("profile.stats.stamp")}
      </Mono>
      <Display size={26} italic style={styles.title}>
        {t("profile.stats.title")}
      </Display>
      <DoubleRule />

      {isError ? (
        <Serif size={13} italic style={styles.muted}>
          {t("profile.stats.error")}
        </Serif>
      ) : isLoading || !data ? (
        <Serif size={13} italic style={styles.muted}>
          {t("profile.stats.loading")}
        </Serif>
      ) : (
        <>
          {/* 指标卡 */}
          <View style={styles.section}>
            <StatStamp label={t("profile.stats.metricsStamp")} />
            <StatCards m={data.metrics} />
          </View>

          {/* 入驻时长 */}
          <Mono size={9} style={styles.joined}>
            {t("profile.stats.joinedDays", { count: data.metrics.joined_days })}
          </Mono>

          <DoubleRule />

          {/* 活跃度点阵 */}
          <View style={styles.section}>
            <StatStamp label={t("profile.stats.activityStamp")} />
            {data.metrics.active_days === 0 ? (
              <Serif size={13} italic style={styles.muted}>
                {t("profile.stats.activityEmpty")}
              </Serif>
            ) : (
              <>
                <ActivityHeatmap
                  start={data.start}
                  end={data.end}
                  days={data.days}
                  monthLabels={months}
                />
                <HeatmapLegend
                  lessLabel={t("profile.stats.legendLess")}
                  moreLabel={t("profile.stats.legendMore")}
                />
                <Mono size={9} style={styles.summary}>
                  {t("profile.stats.activitySummary", {
                    active: data.metrics.active_days,
                    longest: data.metrics.longest_streak,
                  })}
                </Mono>
              </>
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

/** 栏目戳记 — 红菱形 + Mono 大写小字 (与 AttentionView StatStamp 同款). */
function StatStamp({ label }: { label: string }) {
  return (
    <View style={styles.stampRow}>
      <View style={styles.stampDiamond} />
      <Mono size={9} style={styles.sectionStamp}>
        {label}
      </Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: theme.spacing.xs,
  },
  title: { marginBottom: theme.spacing.sm },
  section: {
    gap: theme.spacing.md,
    marginTop: theme.spacing.lg,
  },
  stampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  stampDiamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
  },
  sectionStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  joined: {
    color: theme.color.muted2,
    letterSpacing: 1,
    marginTop: theme.spacing.md,
  },
  summary: {
    color: theme.color.muted,
    letterSpacing: 1,
    marginTop: theme.spacing.xs,
  },
  muted: {
    color: theme.color.muted,
    lineHeight: 22,
    marginTop: theme.spacing.lg,
  },
});
