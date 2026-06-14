import { memo, useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Mono,
  Sans,
  Serif,
  TAB_BAR_CLEARANCE,
  TapEffect,
} from "@/shared/components";
import { theme } from "@/core/theme";
import { haptic } from "@/core/haptics";
import { monthDayLabel, weekdayLabel } from "@/shared/format";
import type { SubscriptionItem, TweetItem } from "@/core/api/subscriptions";

// 具体路径 import (不走 barrel) — 防 index ⇄ Screen 自引用 require cycle (同 InboxView 先例).
import { TweetRow } from "@/features/subscriptions/TweetRow";
import {
  useMarkAllRead,
  useSubscriptions,
  useTweetFeed,
  useUnreadTweetCount,
} from "@/features/subscriptions/hooks";

/**
 * 订阅 tab 主屏 — 当年「报纸」占位的兑现 (UX 规格 §8.2).
 *
 * 结构: 刊头 (Display + 副题 + Mono stamp + 双横线)
 *       → [类型行插槽 — v1 不渲染, 见 §8.0]
 *       → 筛选行 (未读|全部 · 账号 chips · 全部已读)
 *       → 按日分组的推文流 (TweetRow, 智能密度)
 *       → 空态 / 读完态 (编辑部口吻).
 *
 * 你订的账号是通讯社, AI 是编辑部, 这一屏是排出来的报纸.
 */
export function SubscriptionsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const [filter, setFilter] = useState<"unread" | "all">("unread");
  const [accountFilter, setAccountFilter] = useState<string | undefined>(undefined);

  const subsQuery = useSubscriptions();
  const subs = subsQuery.data?.items ?? [];
  const unread = useUnreadTweetCount().data ?? 0;
  const feed = useTweetFeed(filter, accountFilter);
  const markAll = useMarkAllRead();
  const [refreshing, setRefreshing] = useState(false);

  const tweets = useMemo(() => (feed.data?.pages ?? []).flatMap((p) => p.items), [feed.data]);

  // 按日分组 → 拍平成 [日期头, 推文, 推文, 日期头, …] 给 FlatList.
  type Row = { kind: "header"; key: string; label: string } | { kind: "tweet"; tweet: TweetItem };
  const rows = useMemo<Row[]>(() => {
    const out: Row[] = [];
    let lastDay = "";
    for (const tw of tweets) {
      const d = new Date(tw.tweet_created_at);
      const dayKey = Number.isNaN(d.getTime()) ? "unknown" : d.toDateString();
      if (dayKey !== lastDay) {
        lastDay = dayKey;
        const label = Number.isNaN(d.getTime())
          ? t("subscriptions.unknownDate")
          : `${monthDayLabel(d)} · ${weekdayLabel(d)}`;
        out.push({ kind: "header", key: `h-${dayKey}`, label });
      }
      out.push({ kind: "tweet", tweet: tw });
    }
    return out;
  }, [tweets, t]);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await Promise.all([feed.refetch(), subsQuery.refetch()]);
    } finally {
      setRefreshing(false);
    }
  }, [feed, subsQuery]);

  const handleMarkAll = useCallback(() => {
    void haptic.selection();
    markAll.mutate(accountFilter);
  }, [markAll, accountFilter]);

  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={theme.color.ink}
      />
    ),
    [refreshing, handleRefresh],
  );

  const renderRow = useCallback(({ item }: { item: Row }) => {
    if (item.kind === "header") {
      return (
        <Mono size={10} style={styles.dayHeader}>
          {item.label}
        </Mono>
      );
    }
    return <TweetRow tweet={item.tweet} />;
  }, []);

  const keyExtractor = useCallback(
    (item: Row) => (item.kind === "header" ? item.key : item.tweet.id),
    [],
  );

  // 账号 chip 的切换 — 函数式更新, 不依赖 accountFilter, 回调身份稳定 (memo 行受益).
  const handleChipPress = useCallback((id: string) => {
    setAccountFilter((cur) => (cur === id ? undefined : id));
  }, []);

  const renderChip = useCallback(
    ({ item }: { item: SubscriptionItem }) => (
      <AccountChip item={item} active={accountFilter === item.id} onPress={handleChipPress} />
    ),
    [accountFilter, handleChipPress],
  );

  const hasSubs = subs.length > 0;
  const emptyIsAllRead = hasSubs && filter === "unread" && !feed.isLoading;

  return (
    <View style={styles.root}>
      {/* ── 刊头 ── */}
      <View style={[styles.masthead, { paddingTop: insets.top + theme.spacing.xl }]}>
        <View style={styles.mastheadRow}>
          <Display size={30}>{t("subscriptions.masthead.title")}</Display>
          <TapEffect onPress={() => router.push("/subscriptions/manage")} disableEffect>
            <Serif size={13} style={styles.manageLink}>
              {t("subscriptions.masthead.manage")}
            </Serif>
          </TapEffect>
        </View>
        <Serif size={13} italic style={styles.subtitle}>
          {t("subscriptions.masthead.subtitle")}
        </Serif>
        <Mono size={10} style={styles.stamp}>
          {monthDayLabel()} · {weekdayLabel()} · {t("subscriptions.unread", { count: unread })}
        </Mono>
        <View style={styles.rule}>
          <DoubleRule />
        </View>

        {/* ── 筛选行 (类型行插槽在此之上, v1 不渲染) ── */}
        <View style={styles.filterRow}>
          <TapEffect
            onPress={() => setFilter("unread")}
            style={[styles.segPill, filter === "unread" && styles.segPillActive]}
          >
            <Sans
              size={11}
              weight="600"
              style={filter === "unread" ? styles.segTextActive : styles.segText}
            >
              {t("subscriptions.unread", { count: unread })}
            </Sans>
          </TapEffect>
          <TapEffect
            onPress={() => setFilter("all")}
            style={[styles.segPill, filter === "all" && styles.segPillActive]}
          >
            <Sans
              size={11}
              weight="600"
              style={filter === "all" ? styles.segTextActive : styles.segText}
            >
              {t("subscriptions.filter.all")}
            </Sans>
          </TapEffect>
          <View style={styles.filterSpacer} />
          {filter === "unread" && unread > 0 ? (
            <TapEffect onPress={handleMarkAll} disableEffect>
              <Sans size={11} weight="600" style={styles.markAll}>
                {t("subscriptions.filter.markAllRead")}
              </Sans>
            </TapEffect>
          ) : null}
        </View>

        {/* ── 账号 chips (订阅 ≥2 才显示; 横向 FlatList 虚拟化, 「全部账号」走表头) ── */}
        {subs.length >= 2 ? (
          <FlatList<SubscriptionItem>
            horizontal
            showsHorizontalScrollIndicator={false}
            data={subs}
            keyExtractor={chipKeyExtractor}
            contentContainerStyle={styles.accountChips}
            ListHeaderComponent={
              <TapEffect
                onPress={() => setAccountFilter(undefined)}
                style={[styles.chip, !accountFilter && styles.chipActive]}
              >
                <Mono size={10} style={!accountFilter ? styles.chipTextActive : styles.chipText}>
                  {t("subscriptions.chips.all")}
                </Mono>
              </TapEffect>
            }
            renderItem={renderChip}
          />
        ) : null}
      </View>

      <FlatList<Row>
        data={rows}
        keyExtractor={keyExtractor}
        renderItem={renderRow}
        ItemSeparatorComponent={Separator}
        onEndReachedThreshold={0.4}
        onEndReached={() => {
          if (feed.hasNextPage && !feed.isFetchingNextPage) void feed.fetchNextPage();
        }}
        ListEmptyComponent={
          <View style={styles.empty}>
            {!hasSubs && !subsQuery.isLoading ? (
              <View style={styles.emptyInner}>
                <Serif size={14} italic style={styles.emptyText}>
                  {t("subscriptions.empty.noSubs.title")}
                </Serif>
                <TapEffect
                  onPress={() => router.push("/subscriptions/manage")}
                  style={styles.emptyCta}
                >
                  <Sans size={12} weight="600" style={styles.emptyCtaText}>
                    {t("subscriptions.empty.noSubs.cta")}
                  </Sans>
                </TapEffect>
              </View>
            ) : emptyIsAllRead ? (
              <View style={styles.emptyInner}>
                <Mono size={12} style={styles.zeroStamp}>
                  {t("subscriptions.empty.allRead.stamp")}
                </Mono>
                <Serif size={13} italic style={styles.emptyText}>
                  {t("subscriptions.empty.allRead.body")}
                </Serif>
              </View>
            ) : (
              <Serif size={13} italic style={styles.emptyText}>
                {feed.isLoading
                  ? t("subscriptions.empty.loading")
                  : t("subscriptions.empty.noContent")}
              </Serif>
            )}
          </View>
        }
        refreshControl={refreshControl}
        contentContainerStyle={[
          { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE },
          rows.length === 0 ? styles.flexScroll : undefined,
        ]}
      />
    </View>
  );
}

const Separator = () => <View style={styles.sep} />;

const chipKeyExtractor = (s: SubscriptionItem) => s.id;

// 账号 chip — memo 行: onPress/style 在此内组装 (不在 renderItem 内逐行重建), 数据没变就不重绘.
const AccountChip = memo(function AccountChip({
  item,
  active,
  onPress,
}: {
  item: SubscriptionItem;
  active: boolean;
  onPress: (id: string) => void;
}) {
  return (
    <TapEffect onPress={() => onPress(item.id)} style={[styles.chip, active && styles.chipActive]}>
      <Mono size={10} style={active ? styles.chipTextActive : styles.chipText}>
        @{item.handle}
        {item.unread_count > 0 ? ` ${item.unread_count}` : ""}
      </Mono>
    </TapEffect>
  );
});

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  masthead: {
    paddingHorizontal: theme.spacing.lg,
  },
  mastheadRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    justifyContent: "space-between",
  },
  manageLink: {
    color: theme.color.muted,
    paddingBottom: 4,
  },
  subtitle: {
    color: theme.color.muted,
    marginTop: theme.spacing.xs,
  },
  stamp: {
    color: theme.color.muted2,
    marginTop: theme.spacing.xs,
    letterSpacing: 0.5,
  },
  rule: {
    marginTop: theme.spacing.md,
  },
  filterRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  filterSpacer: {
    flex: 1,
  },
  segPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
  },
  segPillActive: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  segText: {
    color: theme.color.muted,
  },
  segTextActive: {
    color: theme.color.paper,
  },
  markAll: {
    color: theme.color.ink2,
    textDecorationLine: "underline",
  },
  accountChips: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
  },
  chip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: 999,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
  },
  chipActive: {
    borderColor: theme.color.ink2,
    backgroundColor: theme.color.paper3,
  },
  chipText: {
    color: theme.color.muted,
  },
  chipTextActive: {
    color: theme.color.ink,
  },
  dayHeader: {
    color: theme.color.muted2,
    letterSpacing: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xs,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ruleSoft,
    marginHorizontal: theme.spacing.lg,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    paddingTop: theme.spacing.xxxl,
  },
  emptyInner: {
    alignItems: "center",
    gap: theme.spacing.md,
  },
  zeroStamp: {
    color: theme.color.ink2,
    letterSpacing: 3,
  },
  emptyText: {
    color: theme.color.muted,
    textAlign: "center",
  },
  emptyCta: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink2,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  emptyCtaText: {
    color: theme.color.ink,
  },
  flexScroll: {
    flexGrow: 1,
  },
});
