import { useCallback, useEffect, useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useSharedValue } from "react-native-reanimated";
import { Image } from "expo-image";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import PagerView, {
  type PagerViewOnPageScrollEventData,
  type PagerViewOnPageSelectedEventData,
} from "react-native-pager-view";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  Sans,
  SegmentedTabs,
  Serif,
  TapEffect,
} from "@/shared/components";
import { haptic } from "@/core/haptics";
import { theme, useThemeColors } from "@/core/theme";
import { resolveApiUrl } from "@/core/api/client";
import { formatMonthDay } from "@/shared/format";
import { ChangeBadge, PriceCurve, changeColor, formatClose } from "@/features/track";
import type { NarrativeDetail, NarrativeItem, NarrativeTarget } from "@/core/api/narrative";

import { useBelieve, useMarkNarrativeRead, useNarrative } from "./hooks";

const KNOWN_MARKETS = new Set(["a", "hk", "us", "crypto", "other"]);

/** 各 tab 内滚动到底时给常驻 believe 条让位的空隙. */
const BAR_CLEARANCE = 76;

/**
 * 叙事详情 (开发文档 E) —— 点列表卡进来.
 *
 * 结构 (镜像标的/叙事列表宿主: 固定抬头 + 吸顶分段栏 + PagerView):
 *   固定抬头 (返回 + status 徽标 + title + dek + 双横线 + 计数) —— 各 tab 共享上下文.
 *   → 分段栏「正文 ｜ 标的 ｜ 来源」(吸顶, 与下方 pager 双向同步), 解决"一页全堆太长".
 *   → PagerView 三页:
 *       ① 正文 —— 头图 hero + 编者散文 (带编号小节 + lede).
 *       ② 标的 —— 投资标的表 (自浮现锚点价格曲线 + 涨跌 + rationale).
 *       ③ 来源 —— 去标识化证据/成员 (类型 + 摘要 + 并入时间).
 *   → 底部常驻「关注」动作条 (跨 tab).
 * 打开即 mark-read.
 */
export function NarrativeDetailScreen({ id }: { id: string | undefined }) {
  const { t } = useTranslation();
  const pagerRef = useRef<PagerView>(null);
  const progress = useSharedValue(0);

  const { data, isLoading, isError } = useNarrative(id);
  const { mutate: markRead } = useMarkNarrativeRead();
  const believe = useBelieve(id);

  // 打开即标记已读 —— data 到达且未读才发, 不 invalidate 故无回环.
  const readAt = data?.read_at;
  useEffect(() => {
    if (id && data && !readAt) {
      markRead(id);
    }
  }, [id, data, readAt, markRead]);

  const tabs = useMemo(
    () => [
      t("narrative.detail.tabs.prose"),
      t("narrative.detail.tabs.targets"),
      t("narrative.detail.tabs.sources"),
    ],
    [t],
  );
  const onPageScroll = useCallback(
    (e: NativeSyntheticEvent<PagerViewOnPageScrollEventData>) => {
      progress.value = e.nativeEvent.position + e.nativeEvent.offset;
    },
    [progress],
  );
  const onPageSelected = useCallback(
    (_e: NativeSyntheticEvent<PagerViewOnPageSelectedEventData>) => {
      void haptic.selection();
    },
    [],
  );
  const handleSelect = useCallback((index: number) => {
    pagerRef.current?.setPage(index);
  }, []);

  const believes = data?.believes === true;
  const onBelieve = () => {
    if (believe.isPending) return;
    believe.mutate(!believes);
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header />
      {isLoading || !data ? (
        <View style={styles.center}>
          <Serif size={13} italic style={styles.muted}>
            {isError ? t("narrative.detail.error") : t("narrative.detail.loading")}
          </Serif>
        </View>
      ) : (
        <>
          {/* 固定抬头 (各 tab 共享上下文) */}
          <View style={styles.head}>
            {data.status === "active" || data.status === "cooling" ? (
              <Mono
                size={9}
                style={[
                  styles.statusBadge,
                  data.status === "cooling" ? styles.statusCooling : null,
                ]}
              >
                {t(`narrative.status.${data.status}` as "narrative.status.active")}
              </Mono>
            ) : null}
            <Display size={24} style={styles.title}>
              {data.title}
            </Display>
            {data.dek ? (
              <Serif size={14} italic style={styles.dek} numberOfLines={3}>
                {data.dek}
              </Serif>
            ) : null}
            <DoubleRule />
            <Mono size={10} style={styles.headMeta}>
              {t("narrative.meta.signals", { count: data.signal_count ?? 0 })}
              {"  ·  "}
              {t("narrative.meta.items", { count: data.item_count ?? 0 })}
            </Mono>
          </View>

          <SegmentedTabs tabs={tabs} progress={progress} onSelect={handleSelect} />

          <PagerView
            ref={pagerRef}
            style={styles.pager}
            initialPage={0}
            onPageScroll={onPageScroll}
            onPageSelected={onPageSelected}
          >
            <View key="prose" style={styles.page} collapsable={false}>
              <ProsePane data={data} />
            </View>
            <View key="targets" style={styles.page} collapsable={false}>
              <TargetsPane data={data} />
            </View>
            <View key="sources" style={styles.page} collapsable={false}>
              <SourcesPane data={data} />
            </View>
          </PagerView>

          {/* Believe 动作条 — 醒目, 跨 tab 常驻底部 */}
          <View style={styles.believeBar}>
            <TapEffect
              style={[styles.believeBtn, believes ? styles.believeBtnActive : null]}
              onPress={onBelieve}
            >
              <Icon
                name={believes ? "starFill" : "star"}
                size={16}
                color={believes ? theme.color.paper : theme.color.red}
                strokeWidth={1.5}
              />
              <Sans
                size={14}
                weight="700"
                style={believes ? styles.believeTextActive : styles.believeText}
              >
                {believes ? t("narrative.believe.active") : t("narrative.believe.cta")}
              </Sans>
            </TapEffect>
          </View>
        </>
      )}
    </SafeAreaView>
  );
}

/** 正文 tab — 头图 hero + 编者散文 (带序号小节, 首段 lede 强调). */
function ProsePane({ data }: { data: NarrativeDetail }) {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.paneScroll} showsVerticalScrollIndicator={false}>
      {data.cover_url ? (
        <Image
          source={{ uri: resolveApiUrl(data.cover_url) }}
          style={styles.hero}
          contentFit="cover"
          transition={150}
          cachePolicy="memory-disk"
          accessibilityIgnoresInvertColors
        />
      ) : null}
      {data.sections.length === 0 ? (
        <Serif size={13} italic style={styles.paneEmpty}>
          {t("narrative.detail.empty.prose")}
        </Serif>
      ) : (
        data.sections.map((sec, idx) => (
          <View key={sec.id} style={idx === 0 ? styles.sectionFirst : styles.section}>
            <View style={styles.sectionHead}>
              <Mono size={11} style={styles.sectionIndex}>
                {String(idx + 1).padStart(2, "0")}
              </Mono>
              <View style={styles.sectionHeadLine} />
            </View>
            {sec.heading ? (
              <Display size={20} style={styles.sectionHeading}>
                {sec.heading}
              </Display>
            ) : null}
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
        ))
      )}
    </ScrollView>
  );
}

/** 标的 tab — 投资标的表. */
function TargetsPane({ data }: { data: NarrativeDetail }) {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.paneScroll} showsVerticalScrollIndicator={false}>
      {data.targets.length === 0 ? (
        <Serif size={13} italic style={styles.paneEmpty}>
          {t("narrative.detail.empty.targets")}
        </Serif>
      ) : (
        data.targets.map((tg) => <TargetRow key={tg.asset.id} target={tg} />)
      )}
    </ScrollView>
  );
}

/** 来源 tab — 去标识化证据/成员. */
function SourcesPane({ data }: { data: NarrativeDetail }) {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.paneScroll} showsVerticalScrollIndicator={false}>
      {data.items.length === 0 ? (
        <Serif size={13} italic style={styles.paneEmpty}>
          {t("narrative.detail.empty.sources")}
        </Serif>
      ) : (
        data.items.map((it, i) => <EvidenceRow key={`${it.item_type}-${i}`} item={it} />)
      )}
    </ScrollView>
  );
}

function EvidenceRow({ item }: { item: NarrativeItem }) {
  const { t } = useTranslation();
  return (
    <View style={styles.evidenceRow}>
      <View style={styles.evidenceHead}>
        <Sans size={9} weight="700" style={styles.evidenceType}>
          {t(`narrative.detail.itemType.${item.item_type}` as "narrative.detail.itemType.signal")}
        </Sans>
        <Mono size={10} style={styles.evidenceDate}>
          {formatMonthDay(item.added_at)}
        </Mono>
      </View>
      {item.summary ? (
        <Serif size={14} style={styles.evidenceSummary}>
          {item.summary}
        </Serif>
      ) : null}
    </View>
  );
}

/** 一行投资标的: 名称/代码 + 角色/信念度 + 价格曲线 + 自浮现至今涨跌 + rationale. */
function TargetRow({ target }: { target: NarrativeTarget }) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { asset } = target;
  const pct = target.pct_since_discovery ?? null;
  const bars = target.bars ?? [];
  const trackable = asset.status !== "untrackable" && bars.length >= 2;

  const marketLabel = KNOWN_MARKETS.has(asset.market ?? "")
    ? t(`track.market.${asset.market}` as "track.market.a")
    : (asset.market ?? "");
  const roleLabel = t(`narrative.detail.role.${target.role}` as "narrative.detail.role.primary");
  const conviction = Math.round((target.conviction ?? 0) * 100);

  return (
    <TapEffect
      style={styles.targetRow}
      pressedStyle={styles.targetPressed}
      onPress={() => router.push(`/asset/${asset.id}`)}
    >
      <View style={styles.targetTop}>
        <View style={styles.targetLeft}>
          <Mono size={13} style={styles.targetTicker}>
            {asset.canonical}
          </Mono>
          <Sans size={10} style={styles.targetName} numberOfLines={1}>
            {asset.name}
            {marketLabel ? ` · ${marketLabel}` : ""}
          </Sans>
        </View>
        <ChangeBadge pct={pct} size={12} />
      </View>

      <View style={styles.targetMetaRow}>
        <Mono size={9} style={styles.targetRole}>
          {roleLabel}
        </Mono>
        <Mono size={9} style={styles.targetConviction}>
          {t("narrative.detail.conviction", { value: conviction })}
        </Mono>
      </View>

      {trackable ? (
        <View style={styles.curveBlock}>
          <View style={styles.curveTop}>
            <Mono size={11} style={styles.latest}>
              {formatClose(target.latest_close)}
            </Mono>
            <Mono size={9} style={styles.sinceLabel}>
              {t("narrative.meta.since")}
            </Mono>
          </View>
          <PriceCurve
            bars={bars}
            color={changeColor(pct, c)}
            baseline={target.anchor_close ?? null}
            height={88}
          />
        </View>
      ) : (
        <Serif size={12} italic style={styles.untrackable}>
          {t("track.state.untrackable")}
        </Serif>
      )}

      {target.rationale ? (
        <Serif size={12} style={styles.rationale}>
          {target.rationale}
        </Serif>
      ) : null}
    </TapEffect>
  );
}

/** 把一段正文按空行/换行拆成自然段. */
function paragraphs(body: string): string[] {
  return body
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function Header() {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>{t("narrative.detail.back")}</Serif>
      </TapEffect>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 56,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
  },
  muted: {
    color: theme.color.muted,
    textAlign: "center",
  },

  // ── 固定抬头 (各 tab 共享) ──
  head: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  statusBadge: {
    color: theme.color.red,
    letterSpacing: 2,
    textTransform: "uppercase",
    alignSelf: "flex-start",
  },
  statusCooling: {
    color: theme.color.muted,
  },
  title: {
    color: theme.color.ink,
  },
  dek: {
    color: theme.color.muted,
    lineHeight: 21,
  },
  headMeta: {
    color: theme.color.muted2,
    letterSpacing: 1,
  },

  // ── pager / pane ──
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
  paneScroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: BAR_CLEARANCE,
  },
  paneEmpty: {
    color: theme.color.muted,
    paddingTop: theme.spacing.lg,
    textAlign: "center",
  },

  // ── 头图 hero (正文 tab 顶) ──
  hero: {
    // 出血到屏幕左右与顶部 (抵消 pane padding), 满宽大图.
    marginTop: -theme.spacing.md,
    marginHorizontal: -theme.spacing.lg,
    marginBottom: theme.spacing.md,
    height: 196,
    backgroundColor: theme.color.paper3,
  },

  // ── 散文 section ──
  sectionFirst: {
    marginTop: 0,
  },
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
    lineHeight: 25,
  },
  paragraph: {
    color: theme.color.ink2,
    marginTop: theme.spacing.sm,
    lineHeight: 23,
  },

  // ── 标的行 ──
  targetRow: {
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
    gap: theme.spacing.sm,
  },
  targetPressed: {
    backgroundColor: theme.color.paper3,
  },
  targetTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  targetLeft: {
    flex: 1,
    gap: 2,
  },
  targetTicker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  targetName: {
    color: theme.color.muted,
  },
  targetMetaRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
  },
  targetRole: {
    color: theme.color.muted2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  targetConviction: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  curveBlock: {
    gap: theme.spacing.xs,
  },
  curveTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  latest: {
    color: theme.color.ink2,
    letterSpacing: 0.5,
  },
  sinceLabel: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  untrackable: {
    color: theme.color.muted,
  },
  rationale: {
    color: theme.color.muted,
    lineHeight: 19,
  },

  // ── 证据行 ──
  evidenceRow: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
    gap: theme.spacing.xs,
  },
  evidenceHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  evidenceType: {
    color: theme.color.ink2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.muted,
    paddingHorizontal: 6,
    paddingVertical: 1,
    letterSpacing: 1,
    overflow: "hidden",
  },
  evidenceDate: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  evidenceSummary: {
    color: theme.color.ink,
    lineHeight: 21,
  },

  // ── Believe 动作条 ──
  believeBar: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
    backgroundColor: theme.color.paper,
  },
  believeBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.red,
    backgroundColor: theme.color.paper,
    paddingVertical: theme.spacing.md,
  },
  believeBtnActive: {
    backgroundColor: theme.color.red,
    borderColor: theme.color.red,
  },
  believeText: {
    color: theme.color.red,
    letterSpacing: 0.5,
  },
  believeTextActive: {
    color: theme.color.paper,
    letterSpacing: 0.5,
  },
});
