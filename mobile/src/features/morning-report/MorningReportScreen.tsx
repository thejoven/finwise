import { useCallback, useEffect, useMemo, useRef } from "react";
import { Animated, RefreshControl, ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Mono,
  Serif,
  TAB_BAR_CLEARANCE,
} from "@/shared/components";
import { theme } from "@/core/theme";
import { monthDayLabel, weekdayLabel } from "@/shared/format";

import type { ReportSection } from "@/core/api/morning-report";
import { useMarkReportRead, useMorningReport } from "@/features/morning-report/hooks";

/**
 * 早报 tab 主屏 — 报纸感版式 (开发文档 16).
 *
 * 平台每日把"前一天全体用户转为信号"的内容去标识化聚合成编者早报, 再按本用户的关注标的
 * 个性化重排 + "为你导读". 结构:
 *   报头 folio (居中刊名 + 副题 + 双横线 + 日期戳)
 *   → 头条 (headline + dek)
 *   → 为你导读 (红 accent 侧栏 + 相关标的 chips, 命中关注才有)
 *   → 主题板块 (带序号; 首段 lede 强调)
 *   → 标的观察 ("行情表": 比例条 + 信号数)
 *   → 版尾 colophon.
 * 无底稿 → 空态; 安静日 → 刊头挂"安静日"角标 + 一段克制短稿.
 */
export function MorningReportScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const { data, isLoading, isError, refetch, isRefetching } = useMorningReport();
  const { mutate: markRead } = useMarkReportRead();

  // 打开即标记已读 (Phase 2 角标用). data 到达且未读才发, 不 invalidate 故无回环.
  const available = data?.available;
  const editionDate = data?.edition_date;
  const readAt = data?.read_at;
  useEffect(() => {
    if (available && editionDate && !readAt) {
      markRead(editionDate);
    }
  }, [available, editionDate, readAt, markRead]);

  // 按 section_order 重排, 漏掉的板块兜底追加在后.
  const ordered = useMemo<ReportSection[]>(() => {
    if (!data) return [];
    const byId = new Map(data.sections.map((s) => [s.id, s]));
    const order = data.section_order.length ? data.section_order : data.sections.map((s) => s.id);
    const seen = new Set<string>();
    const out: ReportSection[] = [];
    for (const id of order) {
      const s = byId.get(id);
      if (s && !seen.has(id)) {
        out.push(s);
        seen.add(id);
      }
    }
    for (const s of data.sections) if (!seen.has(s.id)) out.push(s);
    return out;
  }, [data]);

  // 标的观察比例条的分母 (最受关注标的的信号数).
  const maxAssetSignals = useMemo(() => {
    if (!data?.top_assets.length) return 0;
    return data.top_assets.reduce((m, a) => Math.max(m, a.signal_count), 0);
  }, [data]);

  const onRefresh = useCallback(() => {
    void refetch();
  }, [refetch]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={onRefresh} />}
        showsVerticalScrollIndicator={false}
      >
        {/* 报头 folio (居中) */}
        <View style={[styles.masthead, { paddingTop: insets.top + theme.spacing.xl }]}>
          <Display size={33} style={styles.nameplate}>
            {t("morning.masthead.title")}
          </Display>
          <Serif size={12.5} italic style={styles.subtitle}>
            {t("morning.masthead.subtitle")}
          </Serif>
          <View style={styles.folioRule}>
            <DoubleRule />
          </View>
          <View style={styles.folioMeta}>
            <Mono size={10} style={styles.stamp}>
              {monthDayLabel()} · {weekdayLabel()}
              {available ? `  ·  ${t("morning.stamp.signals", { count: data!.signal_count })}` : ""}
            </Mono>
            {data?.is_quiet ? (
              <Mono size={9} style={styles.quietBadge}>
                {t("morning.quiet")}
              </Mono>
            ) : null}
          </View>
        </View>

        {isLoading ? (
          <SkeletonReport />
        ) : isError ? (
          <View style={styles.center}>
            <Serif size={14} italic style={styles.muted}>
              {t("morning.error")}
            </Serif>
          </View>
        ) : !available ? (
          <View style={styles.center}>
            <Mono size={22} style={styles.emptyMark}>
              ❖
            </Mono>
            <Serif size={16} style={styles.emptyTitle}>
              {t("morning.empty.title")}
            </Serif>
            <Serif size={13} italic style={styles.muted}>
              {t("morning.empty.subtitle")}
            </Serif>
          </View>
        ) : (
          <View style={styles.content}>
            {data!.headline ? (
              <Display size={27} style={styles.headline}>
                {data!.headline}
              </Display>
            ) : null}
            {data!.dek ? (
              <Serif size={15} italic style={styles.dek}>
                {data!.dek}
              </Serif>
            ) : null}

            {/* 为你导读 — 红 accent 侧栏, 与全局正文区分 */}
            {data!.personal_intro || data!.relevant_assets.length > 0 ? (
              <View style={styles.forYou}>
                <Mono size={10} style={styles.forYouKicker}>
                  {t("morning.forYou")}
                </Mono>
                {data!.personal_intro
                  ? paragraphs(data!.personal_intro).map((p, i) => (
                      <Serif key={`fy-${i}`} size={14.5} style={styles.forYouBody}>
                        {p}
                      </Serif>
                    ))
                  : null}
                {data!.relevant_assets.length > 0 ? (
                  <View style={styles.chipRow}>
                    {data!.relevant_assets.map((a) => (
                      <View key={a.ticker} style={styles.chip}>
                        <Mono size={11} style={styles.chipText}>
                          {a.ticker}
                        </Mono>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            ) : null}

            {/* 主题板块 — 带序号; 首段 lede 强调 */}
            {ordered.map((sec, idx) => (
              <View key={sec.id} style={styles.section}>
                <View style={styles.sectionHead}>
                  <Mono size={11} style={styles.sectionIndex}>
                    {String(idx + 1).padStart(2, "0")}
                  </Mono>
                  <View style={styles.sectionHeadLine} />
                </View>
                <Display size={20} style={styles.sectionHeading}>
                  {sec.heading}
                </Display>
                {paragraphs(sec.body).map((p, i) => (
                  <Serif
                    key={`${sec.id}-${i}`}
                    size={idx === 0 && i === 0 ? 16 : 15}
                    style={idx === 0 && i === 0 ? styles.lede : styles.paragraph}
                  >
                    {p}
                  </Serif>
                ))}
              </View>
            ))}

            {/* 标的观察 — "行情表": 比例条 + 信号数 */}
            {data!.top_assets.length > 0 ? (
              <View style={styles.section}>
                <View style={styles.sectionHead}>
                  <Mono size={10} style={styles.kicker}>
                    {t("morning.assets.heading")}
                  </Mono>
                  <View style={styles.sectionHeadLine} />
                </View>
                {data!.top_assets.slice(0, 12).map((a) => (
                  <View key={a.ticker} style={styles.assetRow}>
                    <Mono size={13} style={styles.assetTicker} numberOfLines={1}>
                      {a.ticker}
                    </Mono>
                    <View style={styles.assetBarTrack}>
                      <View
                        style={[
                          styles.assetBarFill,
                          {
                            width: `${
                              maxAssetSignals > 0
                                ? Math.max(8, (a.signal_count / maxAssetSignals) * 100)
                                : 8
                            }%`,
                          },
                        ]}
                      />
                    </View>
                    <Mono size={12} style={styles.assetCount}>
                      {a.signal_count}
                    </Mono>
                  </View>
                ))}
              </View>
            ) : null}

            {/* 版尾 colophon */}
            <View style={styles.colophon}>
              <View style={styles.colophonRule} />
              <Mono size={10} style={styles.footer}>
                {t("morning.footer")} · {data!.edition_date}
              </Mono>
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

/** 把一段正文按空行/换行拆成自然段. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** 加载骨架 — 报头下方占位, 轻脉冲. */
function SkeletonReport() {
  const pulse = useRef(new Animated.Value(0.4)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.4, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  return (
    <Animated.View style={[styles.content, { opacity: pulse }]}>
      <View style={[styles.skelBlock, { width: "82%", height: 26 }]} />
      <View style={[styles.skelBlock, { width: "64%", height: 26, marginTop: 6 }]} />
      <View style={[styles.skelBlock, { width: "100%", height: 14, marginTop: theme.spacing.lg }]} />
      <View style={[styles.skelBlock, { width: "94%", height: 14, marginTop: 8 }]} />
      <View style={[styles.skelBlock, { width: "70%", height: 14, marginTop: 8 }]} />
      <View style={[styles.skelBlock, { width: "40%", height: 12, marginTop: theme.spacing.xl }]} />
      <View style={[styles.skelBlock, { width: "100%", height: 14, marginTop: theme.spacing.md }]} />
      <View style={[styles.skelBlock, { width: "88%", height: 14, marginTop: 8 }]} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },

  // ── 报头 folio ──
  masthead: {
    paddingHorizontal: theme.spacing.lg,
    alignItems: "center",
  },
  nameplate: {
    color: theme.color.ink,
    textAlign: "center",
  },
  subtitle: {
    color: theme.color.muted,
    marginTop: theme.spacing.xs,
    textAlign: "center",
  },
  folioRule: {
    alignSelf: "stretch",
    marginTop: theme.spacing.md,
  },
  folioMeta: {
    alignItems: "center",
    marginTop: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  stamp: {
    color: theme.color.muted2,
    letterSpacing: 1,
  },
  quietBadge: {
    color: theme.color.red,
    letterSpacing: 2,
    textTransform: "uppercase",
  },

  // ── 状态 ──
  center: {
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingVertical: theme.spacing.xl * 2,
    gap: theme.spacing.sm,
  },
  emptyMark: {
    color: theme.color.muted2,
    marginBottom: theme.spacing.xs,
  },
  emptyTitle: {
    color: theme.color.ink,
    textAlign: "center",
  },
  muted: {
    color: theme.color.muted,
    textAlign: "center",
  },
  skelBlock: {
    backgroundColor: theme.color.paper3,
    borderRadius: theme.radius.sm,
  },

  // ── 正文 ──
  content: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  headline: {
    color: theme.color.ink,
  },
  dek: {
    color: theme.color.muted,
    marginTop: theme.spacing.sm,
  },

  // ── 为你导读 ──
  forYou: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.color.paper2,
    borderLeftWidth: 3,
    borderLeftColor: theme.color.red,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
    borderRightColor: theme.color.rule,
    borderBottomColor: theme.color.rule,
    paddingVertical: theme.spacing.base,
    paddingHorizontal: theme.spacing.base,
    gap: theme.spacing.sm,
  },
  forYouKicker: {
    color: theme.color.red,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  forYouBody: {
    color: theme.color.ink2,
  },
  chipRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xxs,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper,
    borderRadius: theme.radius.sm,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs + 1,
  },
  chipText: {
    color: theme.color.ink2,
    letterSpacing: 0.5,
  },

  // ── 主题板块 ──
  section: {
    marginTop: theme.spacing.xl,
  },
  sectionHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  sectionIndex: {
    color: theme.color.red,
    letterSpacing: 1,
  },
  kicker: {
    color: theme.color.muted2,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  sectionHeadLine: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.rule,
  },
  sectionHeading: {
    color: theme.color.ink,
    marginBottom: theme.spacing.xs,
  },
  lede: {
    color: theme.color.ink,
    marginTop: theme.spacing.sm,
  },
  paragraph: {
    color: theme.color.ink2,
    marginTop: theme.spacing.sm,
  },

  // ── 标的观察 (行情表) ──
  assetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  assetTicker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
    width: 92,
  },
  assetBarTrack: {
    flex: 1,
    height: 5,
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.ruleSoft,
    overflow: "hidden",
  },
  assetBarFill: {
    height: "100%",
    borderRadius: theme.radius.full,
    backgroundColor: theme.color.red,
  },
  assetCount: {
    color: theme.color.muted,
    width: 24,
    textAlign: "right",
  },

  // ── 版尾 ──
  colophon: {
    alignItems: "center",
    marginTop: theme.spacing.xxl,
  },
  colophonRule: {
    width: 40,
    height: StyleSheet.hairlineWidth * 2,
    backgroundColor: theme.color.rule,
    marginBottom: theme.spacing.md,
  },
  footer: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
    textAlign: "center",
  },
});
