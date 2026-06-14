/**
 * AttentionScreen — 注意力统计主屏 (tab "统计").
 *
 * 三张 chart-kit 图 + 报刊风配色:
 *   - BarChart  4 维评分横向对比
 *   - LineChart 近 N 次 4 series 趋势
 *   - PieChart  领域分布 top tags
 *
 * 视觉一致性: chart 用 ink/red/muted/green 4 色, 与 ScoreBar / InsightBlock
 * 共用; 背景 paper, 网格 hairline dashed (ruleSoft); 栏目戳记统一为红菱形 + Mono
 * (与 InsightBlock / SectionHeader 同款).
 *
 * 顶部不再放项目"分类切换"条 — 统计跟随其它 tab 选定的全局项目, 仅在报刊头标注.
 */

import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View, useWindowDimensions } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { BarChart, LineChart, PieChart } from "react-native-chart-kit";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Mono,
  SectionHeader,
  Serif,
  TAB_BAR_CLEARANCE,
  TapEffect,
} from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { formatShortDateTime } from "@/shared/format";
import { getAttentionSummary, type WindowKey } from "@/core/api/attention";
import { useActiveProject } from "@/features/project";
import { listProjects } from "@/core/api/project";

import { InsightBlock } from "./InsightBlock";
import { makeBaseChartConfig, makeDimensionColors, makePiePalette, hexToRgba } from "./charts";

const WINDOWS: WindowKey[] = ["7d", "30d", "all"];

export function AttentionScreen() {
  const { t } = useTranslation();
  const [window, setWindow] = useState<WindowKey>("30d");
  // chart 宽度 = 屏宽 - 2 * lg padding (用 hook 而非 Dimensions.get, 随旋转/分屏自适应)
  const { width } = useWindowDimensions();
  const chartWidth = width - 2 * theme.spacing.lg;
  // 给悬浮的灵动岛 tab bar 让位 (标准空隙, 见 glass 的 TAB_BAR_CLEARANCE). 与 inbox 一致.
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + TAB_BAR_CLEARANCE;
  const activeProjectID = useActiveProject((s) => s.activeId);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const activeProject = activeProjectID ? projects?.find((p) => p.id === activeProjectID) : null;

  const { data, isLoading, isError } = useQuery({
    // project_id 是 queryKey 一部分 — 否则切换分类时拿到的是上一次的缓存结果.
    queryKey: ["attention", window, activeProjectID ?? "all"],
    queryFn: () => getAttentionSummary(window, activeProjectID),
    staleTime: 60_000,
  });

  const latest = data?.latest_summaries[0];
  const trendSeries = useMemo(() => (data?.latest_summaries ?? []).slice().reverse(), [data]);

  // chart-kit 只能吃 hex 字符串, 故按当前外观取纯 hex 调色板(而非 theme 的动态色),
  // 外观切换时本组件随 useThemeColors 重渲染, 图表跟着重着色.
  const c = useThemeColors();
  const baseChartConfig = useMemo(() => makeBaseChartConfig(c), [c]);
  const DIMENSION_COLORS = useMemo(() => makeDimensionColors(c), [c]);
  const PIE_PALETTE = useMemo(() => makePiePalette(c), [c]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      {/* 报刊头: 档案标识 · 标题 + 完成数 dateline · 时间窗 */}
      <View style={styles.masthead}>
        <Mono size={9} style={styles.stamp}>
          {t("attention.stamp")}
          {activeProject ? ` · ${activeProject.emoji ?? ""}${activeProject.name}` : ""}
        </Mono>
        <View style={styles.titleRow}>
          <Display size={28} style={styles.title}>
            {t("attention.title")}
          </Display>
          {data && data.total_completed > 0 ? (
            <Mono size={10} style={styles.titleMeta}>
              {t("attention.completedCount", { count: data.total_completed })}
            </Mono>
          ) : null}
        </View>

        <View style={styles.windowRow}>
          {WINDOWS.map((w) => {
            const active = w === window;
            return (
              <TapEffect
                key={w}
                onPress={() => setWindow(w)}
                style={[styles.windowPill, active && styles.windowPillActive]}
              >
                <Mono size={10} style={[styles.windowLabel, active && styles.windowLabelActive]}>
                  {t(`attention.window.${w}`)}
                </Mono>
              </TapEffect>
            );
          })}
        </View>
      </View>
      <View style={styles.mastheadRule}>
        <DoubleRule />
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}>
        {isError ? (
          <Serif size={13} italic style={styles.error}>
            {t("attention.error")}
          </Serif>
        ) : isLoading || !data ? (
          <Serif size={13} italic style={styles.muted}>
            {t("attention.loading")}
          </Serif>
        ) : data.total_completed === 0 ? (
          <View style={styles.emptyBlock}>
            <SectionHeader label={t("attention.empty.header")} meta={t("attention.empty.meta")} />
            <Serif size={14} italic style={styles.muted}>
              {t("attention.empty.body")}
            </Serif>
          </View>
        ) : (
          <>
            {/* 4 维评分 - BarChart 横向对比 */}
            <View style={styles.section}>
              <StatStamp label={t("attention.scores.stamp")} />
              <BarChart
                data={{
                  labels: [
                    t("attention.dimensions.focus"),
                    t("attention.dimensions.depth"),
                    t("attention.dimensions.breadth"),
                    t("attention.dimensions.execution"),
                  ],
                  datasets: [
                    {
                      data: [
                        data.average_focus_score,
                        data.average_depth_score,
                        data.average_breadth_score,
                        data.average_execution_score,
                      ],
                    },
                  ],
                }}
                width={chartWidth}
                height={180}
                yAxisLabel=""
                yAxisSuffix=""
                fromZero
                showValuesOnTopOfBars
                withInnerLines={false}
                chartConfig={{
                  ...baseChartConfig,
                  barPercentage: 0.55,
                  fillShadowGradientFrom: c.ink,
                  fillShadowGradientTo: c.ink,
                  fillShadowGradientFromOpacity: 1,
                  fillShadowGradientToOpacity: 1,
                }}
                style={styles.chartStyle}
                segments={4}
              />
            </View>

            <DoubleRule />

            {/* 本次洞察 */}
            {latest ? (
              <InsightBlock
                insight={latest.insight}
                blindspot={latest.blindspot}
                whenLabel={t("attention.insight.completedAt", {
                  when: formatShortDateTime(latest.created_at),
                  ref: shortRef(latest.refinement_id),
                })}
              />
            ) : null}

            <DoubleRule />

            {/* 趋势 - LineChart 多 series */}
            {trendSeries.length >= 2 ? (
              <View style={styles.section}>
                <StatStamp label={t("attention.trend.stamp", { count: trendSeries.length })} />
                <LineChart
                  data={{
                    labels: trendSeries.map((_, i) => `${i + 1}`),
                    datasets: [
                      {
                        data: trendSeries.map((r) => r.focus_score),
                        color: (op = 1) => hexToRgba(DIMENSION_COLORS.focus, op),
                        strokeWidth: 2,
                      },
                      {
                        data: trendSeries.map((r) => r.depth_score),
                        color: (op = 1) => hexToRgba(DIMENSION_COLORS.depth, op),
                        strokeWidth: 2,
                      },
                      {
                        data: trendSeries.map((r) => r.breadth_score),
                        color: (op = 1) => hexToRgba(DIMENSION_COLORS.breadth, op),
                        strokeWidth: 2,
                      },
                      {
                        data: trendSeries.map((r) => r.execution_score),
                        color: (op = 1) => hexToRgba(DIMENSION_COLORS.execution, op),
                        strokeWidth: 2,
                      },
                    ],
                    legend: [
                      t("attention.dimensions.focus"),
                      t("attention.dimensions.depth"),
                      t("attention.dimensions.breadth"),
                      t("attention.dimensions.execution"),
                    ],
                  }}
                  width={chartWidth}
                  height={220}
                  yAxisSuffix=""
                  fromZero
                  withDots
                  bezier
                  chartConfig={baseChartConfig}
                  style={styles.chartStyle}
                  segments={5}
                />
              </View>
            ) : (
              <View style={styles.section}>
                <StatStamp label={t("attention.trend.stampPlain")} />
                <Serif size={12} italic style={styles.muted}>
                  {t("attention.trend.needMore", { count: trendSeries.length })}
                </Serif>
              </View>
            )}

            <DoubleRule />

            {/* 领域分布 - PieChart */}
            <View style={styles.section}>
              <StatStamp label={t("attention.tags.stamp")} />
              {data.top_tags.length === 0 ? (
                <Serif size={12} italic style={styles.muted}>
                  {t("attention.tags.empty")}
                </Serif>
              ) : (
                <PieChart
                  data={data.top_tags.map((t, i) => ({
                    name: t.tag,
                    count: t.count,
                    color: PIE_PALETTE[i % PIE_PALETTE.length]!,
                    legendFontColor: c.ink2,
                    legendFontSize: 11,
                  }))}
                  width={chartWidth}
                  height={200}
                  chartConfig={baseChartConfig}
                  accessor="count"
                  backgroundColor="transparent"
                  paddingLeft="8"
                  absolute
                />
              )}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** 栏目戳记 — 红菱形 + Mono 大写小字. 与 InsightBlock / SectionHeader 同款图案. */
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

function shortRef(id: string): string {
  return id.slice(0, 8).toUpperCase();
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  masthead: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
  },
  title: {
    color: theme.color.ink,
  },
  titleMeta: {
    color: theme.color.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  windowRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
  },
  windowPill: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  windowPillActive: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  windowLabel: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  windowLabelActive: {
    color: theme.color.paper,
  },
  mastheadRule: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xs,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    // paddingBottom 在组件内用 insets.bottom + TAB_BAR_CLEARANCE 动态算
    gap: theme.spacing.md,
  },
  section: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
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
  chartStyle: {
    marginHorizontal: -theme.spacing.sm, // chart-kit 内部有 left padding, 拉回来
    borderRadius: 0,
  },
  error: {
    color: theme.color.red,
  },
  muted: {
    color: theme.color.muted,
    lineHeight: 22,
  },
  emptyBlock: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.xl,
  },
});
