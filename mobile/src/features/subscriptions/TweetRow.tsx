import { memo } from "react";
import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { relativeTimeZh } from "@/shared/format";
import type { TweetItem } from "@/core/api/subscriptions";

import { useMarkTweetRead } from "./hooks";

/**
 * TweetRow — 报纸条目, 不是社交卡片 (无头像大图、无互动计数).
 *
 * 智能密度 (UX 规格 §8.2 的决策):
 *   - 原文 ≤100 字 → 原文直接当标题 (短推的总结是同义反复)
 *   - >100 字且有 AI 总结 → 总结当标题 (编辑拟的题), 原文降为 muted 摘录
 *   - 总结未就绪 → 原文当标题 + 行尾淡字「AI 正在读…」
 *
 * 已读态: 整行 ink→muted, ◆ 消失. 点行 = 乐观已读 + push 详情.
 */
export const TweetRow = memo(function TweetRow({ tweet }: { tweet: TweetItem }) {
  const { t } = useTranslation();
  const markRead = useMarkTweetRead();

  const chars = [...tweet.text].length;
  const useSummaryAsHeadline = !!tweet.summary && chars > 100;
  const headline = useSummaryAsHeadline ? tweet.summary! : tweet.text;
  const snippet = useSummaryAsHeadline ? tweet.text : null;
  const aiReading = tweet.classify_status === "pending" && !tweet.summary;

  const hasPhoto = (tweet.media ?? []).some((m) => m.type === "photo");
  const hasVideo = (tweet.media ?? []).some((m) => m.type !== "photo");

  const handlePress = () => {
    if (!tweet.read) markRead.mutate(tweet.id);
    router.push(`/tweet/${tweet.id}`);
  };

  const inkColor = tweet.read ? theme.color.muted : theme.color.ink;

  return (
    <TapEffect onPress={handlePress} style={styles.row}>
      <View style={styles.meta}>
        <Mono size={10} style={styles.metaText} numberOfLines={1}>
          {tweet.is_retweet ? t("subscriptions.row.retweet") : ""}@{tweet.handle} ·{" "}
          {relativeTimeZh(tweet.tweet_created_at)}
        </Mono>
        {!tweet.read ? (
          <Sans size={10} weight="600" style={styles.unreadMark}>
            ◆
          </Sans>
        ) : null}
      </View>

      <Serif
        size={14}
        weight="semibold"
        style={[styles.headline, { color: inkColor }]}
        numberOfLines={3}
      >
        {headline}
      </Serif>

      {snippet ? (
        <Serif size={12} style={styles.snippet} numberOfLines={2}>
          {snippet}
        </Serif>
      ) : null}

      <View style={styles.tagRow}>
        {tweet.category ? (
          <View style={[styles.pill, styles.categoryPill]}>
            <Sans size={9} weight="600" style={styles.categoryText}>
              {tweet.category}
            </Sans>
          </View>
        ) : null}
        {(tweet.tags ?? []).slice(0, 3).map((tag) => (
          <View key={tag} style={styles.pill}>
            <Sans size={9} style={styles.pillText}>
              {tag}
            </Sans>
          </View>
        ))}
        {hasPhoto ? (
          <Mono size={9} style={styles.mediaMark}>
            {t("subscriptions.row.photo")}
          </Mono>
        ) : null}
        {hasVideo ? (
          <Mono size={9} style={styles.mediaMark}>
            {t("subscriptions.row.video")}
          </Mono>
        ) : null}
        {aiReading ? (
          <Mono size={9} style={styles.aiReading}>
            {t("subscriptions.row.aiReading")}
          </Mono>
        ) : null}
      </View>
    </TapEffect>
  );
});

const styles = StyleSheet.create({
  row: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    gap: 4,
  },
  meta: {
    flexDirection: "row",
    alignItems: "center",
  },
  metaText: {
    color: theme.color.muted,
    flex: 1,
  },
  unreadMark: {
    color: theme.color.ink,
    marginLeft: theme.spacing.sm,
  },
  headline: {
    lineHeight: 21,
  },
  snippet: {
    color: theme.color.muted2,
    lineHeight: 18,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 2,
  },
  pill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  pillText: {
    color: theme.color.muted,
  },
  categoryPill: {
    borderColor: theme.color.ink3,
  },
  categoryText: {
    color: theme.color.ink2,
  },
  mediaMark: {
    color: theme.color.muted2,
  },
  aiReading: {
    color: theme.color.muted2,
    fontStyle: "italic",
  },
});
