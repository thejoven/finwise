/**
 * AttentionScreen — 注意力统计主屏 (tab "统计").
 *
 * 三张 chart-kit 图 + 报刊风配色:
 *   - BarChart  4 维评分横向对比
 *   - LineChart 近 N 次 4 series 趋势
 *   - PieChart  领域分布 top tags
 *
 * 视觉一致性: chart 用 ink/red/muted/green 4 色, 与 ScoreBar / InsightBlock
 * 共用; 背景 paper, 网格 hairline dashed (ruleSoft).
 */

import { useMemo, useState } from "react";
import { Dimensions, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery } from "@tanstack/react-query";
import { BarChart, LineChart, PieChart } from "react-native-chart-kit";

import { Display, DoubleRule, Mono, SectionHeader, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { getAttentionSummary, type WindowKey } from "@/core/api/attention";
import { ProjectChipsRow, useActiveProject } from "@/features/project";
import { listProjects } from "@/core/api/project";

import { InsightBlock } from "./InsightBlock";
import { baseChartConfig, DIMENSION_COLORS, PIE_PALETTE, hexToRgba } from "./charts";

const WINDOWS: WindowKey[] = ["7d", "30d", "all"];
const WINDOW_LABEL: Record<WindowKey, string> = { "7d": "7 天", "30d": "30 天", all: "全部" };

// chart 宽度 = 屏宽 - 2 * lg padding
const CHART_WIDTH = Dimensions.get("window").width - 2 * theme.spacing.lg;

export function AttentionScreen() {
  const [window, setWindow] = useState<WindowKey>("30d");
  // NativeTabs glass bar ~49pt + home indicator (insets.bottom). 与 inbox 一致.
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + 64;
  const activeProjectID = useActiveProject((s) => s.activeId);

  const { data: projects } = useQuery({
    queryKey: ["projects"],
    queryFn: listProjects,
    staleTime: 60_000,
  });
  const activeProject = activeProjectID
    ? projects?.find((p) => p.id === activeProjectID)
    : null;

  const { data, isLoading, isError } = useQuery({
    // project_id 是 queryKey 一部分 — 否则切换分类时拿到的是上一次的缓存结果.
    queryKey: ["attention", window, activeProjectID ?? "all"],
    queryFn: () => getAttentionSummary(window, activeProjectID),
    staleTime: 60_000,
  });

  const latest = data?.latest_summaries[0];
  const trendSeries = useMemo(() => (data?.latest_summaries ?? []).slice().reverse(), [data]);

  return (
    <SafeAreaView edges={["top"]} style={styles.root}>
      <View style={styles.masthead}>
        <Mono size={9} style={styles.stamp}>
          VOL. I · 注意力档案{activeProject ? ` · ${activeProject.emoji ?? ""}${activeProject.name}` : " · 全部分类"}
        </Mono>
        <Display size={28} style={styles.title}>
          统计
        </Display>
      </View>
      <ProjectChipsRow />

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
                {WINDOW_LABEL[w]}
              </Mono>
            </TapEffect>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}>
        {isError ? (
          <Serif size={13} italic style={styles.error}>
            读统计数据失败, 下拉刷新或稍后再开.
          </Serif>
        ) : isLoading || !data ? (
          <Serif size={13} italic style={styles.muted}>
            正在汇总…
          </Serif>
        ) : data.total_completed === 0 ? (
          <View style={styles.emptyBlock}>
            <SectionHeader label="还没数据" meta="完成第一次五轮追问后会出现" />
            <Serif size={14} italic style={styles.muted}>
              系统会在每次五轮追问完成后, 自动生成本次的注意力档案 — 包含 4 个维度评分 + 一条洞察 +
              一条盲点提示.
            </Serif>
          </View>
        ) : (
          <>
            {/* 4 维评分 - BarChart 横向对比 */}
            <View style={styles.section}>
              <Mono size={9} style={styles.sectionStamp}>
                {`◆ 近期均值 · ${data.total_completed} 次完成`}
              </Mono>
              <BarChart
                data={{
                  labels: ["专注", "深度", "广度", "执行"],
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
                width={CHART_WIDTH}
                height={180}
                yAxisLabel=""
                yAxisSuffix=""
                fromZero
                showValuesOnTopOfBars
                withInnerLines={false}
                chartConfig={{
                  ...baseChartConfig,
                  barPercentage: 0.55,
                  fillShadowGradientFrom: theme.color.ink,
                  fillShadowGradientTo: theme.color.ink,
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
                whenLabel={`完成于 ${formatDate(latest.created_at)} · ${shortRef(latest.refinement_id)}`}
              />
            ) : null}

            <DoubleRule />

            {/* 趋势 - LineChart 多 series */}
            {trendSeries.length >= 2 ? (
              <View style={styles.section}>
                <Mono size={9} style={styles.sectionStamp}>
                  ◆ 趋势 · 近 {trendSeries.length} 次
                </Mono>
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
                    legend: ["专注", "深度", "广度", "执行"],
                  }}
                  width={CHART_WIDTH}
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
                <Mono size={9} style={styles.sectionStamp}>
                  ◆ 趋势
                </Mono>
                <Serif size={12} italic style={styles.muted}>
                  需要 2 次以上完成才能画趋势曲线 — 当前 {trendSeries.length} 次.
                </Serif>
              </View>
            )}

            <DoubleRule />

            {/* 领域分布 - PieChart */}
            <View style={styles.section}>
              <Mono size={9} style={styles.sectionStamp}>
                ◆ 领域分布
              </Mono>
              {data.top_tags.length === 0 ? (
                <Serif size={12} italic style={styles.muted}>
                  近期没有可统计的标签.
                </Serif>
              ) : (
                <PieChart
                  data={data.top_tags.map((t, i) => ({
                    name: t.tag,
                    count: t.count,
                    color: PIE_PALETTE[i % PIE_PALETTE.length]!,
                    legendFontColor: theme.color.ink2,
                    legendFontSize: 11,
                  }))}
                  width={CHART_WIDTH}
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

function formatDate(iso: string): string {
  const d = new Date(iso);
  const mm = (d.getMonth() + 1).toString().padStart(2, "0");
  const dd = d.getDate().toString().padStart(2, "0");
  const hh = d.getHours().toString().padStart(2, "0");
  const mi = d.getMinutes().toString().padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
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
    gap: theme.spacing.xs,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  title: {
    color: theme.color.ink,
  },
  windowRow: {
    flexDirection: "row",
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
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
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    // paddingBottom 在组件内用 insets.bottom + 64 动态算
    gap: theme.spacing.md,
  },
  section: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.sm,
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
