import { useCallback, useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Display, DoubleRule, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { monthDayLabel, weekdayLabel } from "@/shared/format";

// 具体路径 import (不走 barrel) — 防 index ⇄ Screen 自引用 require cycle (同 InboxView 先例).
import { SwipeDeck } from "@/features/subscriptions/SwipeDeck";
import {
  useMarkTweetRead,
  useNotInterested,
  usePromoteTweet,
  useSaveTweet,
  useSubscriptions,
  useTweetFeed,
  useUnreadTweetCount,
} from "@/features/subscriptions/hooks";

/**
 * 订阅 tab 主屏 — 卡片分拣台 (开发文档 15).
 *
 * 结构: 刊头 (Display + 副题 + Mono stamp + 双横线 + 手势图例)
 *       → SwipeDeck (一次一张, 左已读/右转信号/下不感兴趣)
 *       → 没订阅时退回"添加第一个账号"引导.
 *
 * 列表式按日分组的旧版 (TweetRow) 暂留作可选回退 (开发文档 §3 硬三), 不在此屏渲染.
 */
export function SubscriptionsScreen() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();

  const subsQuery = useSubscriptions();
  const hasSubs = (subsQuery.data?.items.length ?? 0) > 0;
  const feed = useTweetFeed("unread");
  const unread = useUnreadTweetCount().data ?? 0;
  const { mutate: markRead } = useMarkTweetRead();
  const { mutate: promote } = usePromoteTweet();
  const { mutate: notInterested } = useNotInterested();
  const { mutate: saveLater } = useSaveTweet();

  const tweets = useMemo(() => (feed.data?.pages ?? []).flatMap((p) => p.items), [feed.data]);

  // 稳定回调身份 —— react-query 的 mutate / fetchNextPage 本就稳定, 包成稳定的 props.
  // 否则每帧新建的箭头会让 SwipeDeck 的 GestureDetector 手势每帧重建, 触发 RNGH 的
  // "Maximum update depth" 循环.
  const { fetchNextPage } = feed;
  const onNeedMore = useCallback(() => {
    void fetchNextPage();
  }, [fetchNextPage]);
  const onRead = useCallback((id: string) => markRead(id), [markRead]);
  const onPromote = useCallback((id: string) => promote({ id }), [promote]);
  const onNotInterested = useCallback((id: string) => notInterested(id), [notInterested]);
  const onSaveLater = useCallback((id: string) => saveLater(id), [saveLater]);

  return (
    <View style={styles.root}>
      <View style={[styles.masthead, { paddingTop: insets.top + theme.spacing.xl }]}>
        <View style={styles.mastheadRow}>
          <Display size={30}>{t("subscriptions.masthead.title")}</Display>
          <View style={styles.mastheadActions}>
            <TapEffect onPress={() => router.push("/subscriptions/saved")} disableEffect>
              <Serif size={13} style={styles.manageLink}>
                {t("subscriptions.masthead.saved")}
              </Serif>
            </TapEffect>
            <TapEffect onPress={() => router.push("/subscriptions/manage")} disableEffect>
              <Serif size={13} style={styles.manageLink}>
                {t("subscriptions.masthead.manage")}
              </Serif>
            </TapEffect>
          </View>
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
        <View style={styles.legend}>
          <Mono size={11} style={styles.legendRead}>
            ← {t("subscriptions.swipe.actRead")}
          </Mono>
          <Mono size={11} style={styles.legendRead}>
            ↑ {t("subscriptions.swipe.actSave")}
          </Mono>
          <Mono size={11} style={styles.legendSkip}>
            ↓ {t("subscriptions.swipe.actSkip")}
          </Mono>
          <Mono size={11} style={styles.legendSignal}>
            {t("subscriptions.swipe.actSignal")} →
          </Mono>
        </View>
      </View>

      {!hasSubs && !subsQuery.isLoading ? (
        <View style={styles.noSubs}>
          <Serif size={14} italic style={styles.noSubsText}>
            {t("subscriptions.empty.noSubs.title")}
          </Serif>
          <TapEffect onPress={() => router.push("/subscriptions/manage")} style={styles.noSubsCta}>
            <Sans size={12} weight="600" style={styles.noSubsCtaText}>
              {t("subscriptions.empty.noSubs.cta")}
            </Sans>
          </TapEffect>
        </View>
      ) : (
        <SwipeDeck
          tweets={tweets}
          isLoading={feed.isLoading || feed.isFetchingNextPage}
          hasNextPage={!!feed.hasNextPage}
          fetchNextPage={onNeedMore}
          onRead={onRead}
          onPromote={onPromote}
          onNotInterested={onNotInterested}
          onSaveLater={onSaveLater}
        />
      )}
    </View>
  );
}

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
  mastheadActions: {
    flexDirection: "row",
    gap: theme.spacing.md,
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
  legend: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: theme.spacing.md,
    rowGap: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  legendRead: {
    color: theme.color.ink2,
  },
  legendSkip: {
    color: theme.color.red,
  },
  legendSignal: {
    color: theme.color.green,
  },
  noSubs: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  noSubsText: {
    color: theme.color.muted,
    textAlign: "center",
  },
  noSubsCta: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink2,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  noSubsCtaText: {
    color: theme.color.ink,
  },
});
