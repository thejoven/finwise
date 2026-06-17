/**
 * TrackHubView —— 「标的追踪」着陆 / Hub 首页 (财知第三张子页, 替换原仅标的速览 AssetsView).
 *
 * 一次 GET /v1/track/overview 取齐三段, 各按"最新"倒序, 每项下钻到对应 detail:
 *   ① 关联标的 —— 你碰过的标的 + 最新价 + 发现至今涨跌 (红涨绿跌) + 命题数 → /asset/[id] 专页.
 *   ② 信号 —— 最近带标的的信号 + 其标的 → /signal/[id].
 *   ③ 订阅信息 —— 最新订阅推文 (summary 空时用 text 兜底; relevance 角标) → /tweet/[id].
 *
 * 报刊式克制: 不堆榜单、不按涨幅排名 (后端已按 last_touched/captured_at/created_at 倒序);
 * 诚实兜底: 不可追踪标的显示"无法追踪", 已归一未定价显示"暂无价", 一律不画假价.
 *
 * 作为 PagerView 一页: 报头 / 分段栏在财知 host, 故无 SafeAreaView top; 底部留
 * insets.bottom + TAB_BAR_CLEARANCE 给悬浮岛 tab bar 让位 (与其它子页一致).
 */

import { useMemo, type ReactNode } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  DoubleRule,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TAB_BAR_CLEARANCE,
  TapEffect,
} from "@/shared/components";
import { theme } from "@/core/theme";
import { formatMonthDay, formatShortDateTime } from "@/shared/format";
import type { TrackOverviewAsset, TrackOverviewSignal, TrackOverviewTweet } from "@/core/api/track";

import { useTrackOverview } from "./hooks";
import { ChangeBadge } from "./ChangeBadge";
import { formatClose } from "./format";

const KNOWN_MARKETS = new Set(["a", "hk", "us", "other"]);
/** 一次取多少 (后端各段上限; Hub 罗列所有最新, 不再二次截断, 故只此一道闸). */
const OVERVIEW_LIMIT = 20;
/** 信号行最多并排几枚标的标签. */
const MAX_CHIPS = 4;

/** 有最新价可展示 = 非 untrackable 且后端给了 latest_close. 决定行内画价还是"无法追踪/暂无价". */
function isPriced(a: TrackOverviewAsset): boolean {
  return a.asset.status !== "untrackable" && a.latest_close != null;
}

export function TrackHubView() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data, isLoading, isError } = useTrackOverview(OVERVIEW_LIMIT);

  const assets = data?.assets ?? [];
  const signals = data?.signals ?? [];
  const tweets = data?.tweets ?? [];
  const isEmpty = !isLoading && !isError && !assets.length && !signals.length && !tweets.length;

  // 关联标的: 有最新价的浮在前 (这页讲"发现后怎么走"); 两组各自保留后端 last_touched 序.
  // 分组而非 sort —— 不就地改 react-query 缓存数组, 也省一次全排序.
  const orderedAssets = useMemo(
    () => [...assets.filter(isPriced), ...assets.filter((a) => !isPriced(a))],
    [assets],
  );

  const bottomPad = insets.bottom + TAB_BAR_CLEARANCE;

  return (
    <ScrollView
      style={styles.root}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      <Serif size={13} italic style={styles.intro}>
        {t("track.hub.intro")}
      </Serif>

      {isLoading ? (
        <StatusLine text={t("track.hub.loading")} />
      ) : isError ? (
        <StatusLine text={t("track.hub.error")} />
      ) : isEmpty ? (
        <StatusLine text={t("track.hub.empty")} />
      ) : (
        <>
          <Section label={t("track.hub.assets.label")} meta={t("track.hub.assets.meta")}>
            {assets.length ? (
              orderedAssets.map((a) => <HubAssetRow key={a.asset.id} item={a} />)
            ) : (
              <EmptyLine text={t("track.hub.assets.empty")} />
            )}
          </Section>

          <Section label={t("track.hub.signals.label")} meta={t("track.hub.signals.meta")}>
            {signals.length ? (
              signals.map((s) => <HubSignalRow key={s.signal_id} item={s} />)
            ) : (
              <EmptyLine text={t("track.hub.signals.empty")} />
            )}
          </Section>

          <Section label={t("track.hub.tweets.label")} meta={t("track.hub.tweets.meta")}>
            {tweets.length ? (
              tweets.map((tw) => <HubTweetRow key={tw.id} item={tw} />)
            ) : (
              <EmptyLine text={t("track.hub.tweets.empty")} />
            )}
          </Section>
        </>
      )}
    </ScrollView>
  );
}

function Section({ label, meta, children }: { label: string; meta: string; children: ReactNode }) {
  return (
    <View style={styles.section}>
      <SectionHeader label={label} meta={meta} />
      <DoubleRule />
      <View style={styles.list}>{children}</View>
    </View>
  );
}

function StatusLine({ text }: { text: string }) {
  return (
    <Serif size={13} italic style={styles.status}>
      {text}
    </Serif>
  );
}

function EmptyLine({ text }: { text: string }) {
  return (
    <Serif size={12} italic style={styles.empty}>
      {text}
    </Serif>
  );
}

// ───── ① 关联标的 ─────

function HubAssetRow({ item }: { item: TrackOverviewAsset }) {
  const { t } = useTranslation();
  const { asset } = item;

  const marketLabel = KNOWN_MARKETS.has(asset.market)
    ? t(`track.market.${asset.market}` as "track.market.a")
    : asset.market;
  const sub = [asset.name, marketLabel].filter(Boolean).join(" · ");

  const untrackable = asset.status === "untrackable";
  const priced = isPriced(item);

  return (
    <TapEffect
      style={styles.row}
      pressedStyle={styles.rowPressed}
      onPress={() => router.push(`/asset/${asset.id}`)}
    >
      <View style={styles.rowLeft}>
        <Mono size={13} style={styles.ticker}>
          {asset.canonical}
        </Mono>
        <Sans size={10} style={styles.sub} numberOfLines={1}>
          {sub}
        </Sans>
        <Mono size={9} style={styles.metaLine}>
          {t("track.hub.thesisCount", { count: item.thesis_count })}
        </Mono>
      </View>

      {priced ? (
        <View style={styles.rowRight}>
          <Mono size={13} style={styles.close}>
            {formatClose(item.latest_close)}
          </Mono>
          <ChangeBadge pct={item.pct_since_discovery ?? null} size={12} />
          <Mono size={9} style={styles.since}>
            {t("track.since.discovery")}
          </Mono>
        </View>
      ) : (
        <Serif size={12} italic style={styles.untrackable}>
          {untrackable ? t("track.state.untrackable") : t("track.hub.noPrice")}
        </Serif>
      )}
    </TapEffect>
  );
}

// ───── ② 信号 ─────

function HubSignalRow({ item }: { item: TrackOverviewSignal }) {
  const { t } = useTranslation();
  const summary = item.summary.trim() || t("track.hub.signals.noSummary");
  const chips = item.assets.slice(0, MAX_CHIPS);
  const extra = item.assets.length - chips.length;

  return (
    <TapEffect
      style={styles.block}
      pressedStyle={styles.rowPressed}
      onPress={() => router.push(`/signal/${item.signal_id}`)}
    >
      <Serif size={14} style={styles.summary} numberOfLines={2}>
        {summary}
      </Serif>
      <View style={styles.chipsRow}>
        {chips.map((a) => (
          <View
            key={a.canonical}
            style={[styles.chip, a.status === "untrackable" && styles.chipMuted]}
          >
            <Mono size={9} style={styles.chipText}>
              {a.canonical}
            </Mono>
          </View>
        ))}
        {extra > 0 ? (
          <Mono size={9} style={styles.chipMore}>
            {t("track.hub.more", { count: extra })}
          </Mono>
        ) : null}
        <View style={styles.spacer} />
        <Mono size={9} style={styles.date}>
          {formatMonthDay(item.captured_at)}
        </Mono>
      </View>
    </TapEffect>
  );
}

// ───── ③ 订阅信息 ─────

function HubTweetRow({ item }: { item: TrackOverviewTweet }) {
  const { t } = useTranslation();
  // summary 空 → text 兜底 (未分类推文); 折叠换行/空白, 行内紧凑.
  const body = (item.summary?.trim() || item.text.trim() || "").replace(/\s+/g, " ");
  const rel = relevancePct(item.relevance);

  return (
    <TapEffect
      style={styles.block}
      pressedStyle={styles.rowPressed}
      onPress={() => router.push(`/tweet/${item.id}`)}
    >
      <View style={styles.tweetHead}>
        <Mono size={11} style={styles.handle}>
          @{item.handle}
        </Mono>
        {rel != null ? (
          <View style={styles.relBadge}>
            <Mono size={8} style={styles.relText}>
              {t("track.hub.relevance", { pct: rel })}
            </Mono>
          </View>
        ) : null}
        <View style={styles.spacer} />
        <Mono size={9} style={styles.date}>
          {formatShortDateTime(item.tweet_created_at)}
        </Mono>
      </View>
      <Sans size={13} style={styles.tweetBody} numberOfLines={3}>
        {body}
      </Sans>
    </TapEffect>
  );
}

/** 相关度 → 整数百分比. 兼容 0..1 小数与已是百分比的情形; 越界裁回 [0,100]. null → null. */
function relevancePct(r: number | null | undefined): number | null {
  if (r == null || Number.isNaN(r)) return null;
  const pct = r <= 1 ? r * 100 : r;
  return Math.round(Math.max(0, Math.min(100, pct)));
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  intro: {
    color: theme.color.muted,
  },
  status: {
    color: theme.color.muted,
    textAlign: "center",
    lineHeight: 22,
    paddingTop: theme.spacing.xxxl,
    paddingHorizontal: theme.spacing.lg,
  },
  section: {
    marginTop: theme.spacing.xl,
  },
  list: {
    marginTop: theme.spacing.xs,
  },
  empty: {
    color: theme.color.muted,
    paddingVertical: theme.spacing.sm,
  },

  // 行容器 (标的行) / 块容器 (信号 · 推文)
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  block: {
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.base,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  rowPressed: {
    backgroundColor: theme.color.paper3,
  },

  // 标的行
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  ticker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  sub: {
    color: theme.color.muted,
  },
  metaLine: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 2,
    minWidth: 72,
  },
  close: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  since: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  untrackable: {
    color: theme.color.muted,
    flexShrink: 1,
    textAlign: "right",
  },

  // 信号块
  summary: {
    color: theme.color.ink,
    lineHeight: 20,
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  chip: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  chipMuted: {
    borderColor: theme.color.ruleSoft,
    backgroundColor: "transparent",
  },
  chipText: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
  chipMore: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  spacer: {
    flex: 1,
  },
  date: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },

  // 推文块
  tweetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  handle: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  relBadge: {
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  relText: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
  tweetBody: {
    color: theme.color.ink,
    lineHeight: 19,
  },
});
