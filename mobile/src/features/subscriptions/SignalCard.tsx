/**
 * SignalCard — 卡片台的单卡视图 (开发文档 §4.2).
 *
 * 报刊式克制, 不是社交卡片:
 *   - 智能密度: 原文 >100 字且有 AI 总结 → 总结当标题、原文降为引用块; 否则原文直接当标题.
 *   - 底部页脚显**来源** (X), **不显**点赞/转发/观看数 (明确要求).
 *   - 纯展示组件: 无手势 / 无动画 (那些在 SwipeDeck 的 Animated 包裹层). 故可安全用动态色 theme.color.
 */

import { StyleSheet, View } from "react-native";

import { Icon, Mono, Sans, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import { monthDayLabel, relativeTimeZh } from "@/shared/format";
import type { TweetItem } from "@/core/api/subscriptions";

export function SignalCard({ tweet }: { tweet: TweetItem }) {
  const chars = [...tweet.text].length;
  const useSummary = !!tweet.summary && chars > 100;
  const headline = useSummary ? tweet.summary! : tweet.text;
  const snippet = useSummary ? tweet.text : null;
  const aiReading = tweet.classify_status === "pending" && !tweet.summary;
  const tags = (tweet.tags ?? []).slice(0, 3);
  const assets = (tweet.related_assets ?? []).slice(0, 3);
  const hasPhoto = (tweet.media ?? []).some((m) => m.type === "photo");
  const hasVideo = (tweet.media ?? []).some((m) => m.type !== "photo");
  const initial = (tweet.display_name || tweet.handle || "·").trim().charAt(0).toUpperCase();
  const postedAt = new Date(tweet.tweet_created_at);
  const dateLabel = Number.isNaN(postedAt.getTime()) ? "" : monthDayLabel(postedAt);

  return (
    <View style={styles.card}>
      <View style={styles.top}>
        {tweet.category ? (
          <View style={styles.categoryPill}>
            <Sans size={9} weight="600" style={styles.categoryText}>
              {tweet.category}
            </Sans>
          </View>
        ) : (
          <View />
        )}
        <Mono size={11} style={styles.time}>
          {tweet.is_retweet ? "RT · " : ""}
          {relativeTimeZh(tweet.tweet_created_at)}
        </Mono>
      </View>

      <View style={styles.author}>
        <View style={styles.avatar}>
          <Serif size={15} style={styles.avatarText}>
            {initial}
          </Serif>
        </View>
        <View style={styles.authorMeta}>
          <Sans size={14} weight="600" style={styles.name} numberOfLines={1}>
            {tweet.display_name || tweet.handle}
          </Sans>
          <Mono size={11} style={styles.handle} numberOfLines={1}>
            @{tweet.handle}
          </Mono>
        </View>
      </View>

      {useSummary ? (
        <Sans size={10} weight="600" style={styles.eyebrow}>
          AI 提炼
        </Sans>
      ) : null}

      <Serif size={18} weight="semibold" style={styles.headline} numberOfLines={useSummary ? 4 : 7}>
        {headline}
      </Serif>

      {snippet ? (
        <View style={styles.snip}>
          <Mono size={10} style={styles.snipLabel}>
            原文
          </Mono>
          <Serif size={13} style={styles.snipText} numberOfLines={3}>
            {snippet}
          </Serif>
        </View>
      ) : null}

      {assets.length > 0 ? (
        <View style={styles.assetRow}>
          {assets.map((a) => (
            <View
              key={a.canonical}
              style={[styles.assetChip, a.tracked && styles.assetChipTracked]}
            >
              {a.tracked ? <Icon name="starFill" size={11} color={theme.color.green} /> : null}
              <Sans
                size={11}
                weight="600"
                style={[styles.assetName, a.tracked && styles.assetTracked]}
              >
                {a.name}
              </Sans>
              <Mono size={10} style={[styles.assetCode, a.tracked && styles.assetTracked]}>
                {a.market === "us" ? `$${a.canonical}` : a.canonical}
              </Mono>
            </View>
          ))}
        </View>
      ) : null}

      {tags.length > 0 || hasPhoto || hasVideo || aiReading ? (
        <View style={styles.tagRow}>
          {tags.map((tag) => (
            <View key={tag} style={styles.pill}>
              <Sans size={9} style={styles.pillText}>
                {tag}
              </Sans>
            </View>
          ))}
          {hasPhoto ? (
            <Mono size={9} style={styles.mediaMark}>
              [图]
            </Mono>
          ) : null}
          {hasVideo ? (
            <Mono size={9} style={styles.mediaMark}>
              [视频]
            </Mono>
          ) : null}
          {aiReading ? (
            <Mono size={9} style={styles.aiReading}>
              AI 正在读…
            </Mono>
          ) : null}
        </View>
      ) : null}

      <View style={styles.footer}>
        <View style={styles.srcLeft}>
          <View style={styles.srcMark}>
            <Sans size={10} weight="700" style={styles.srcMarkText}>
              X
            </Sans>
          </View>
          <Mono size={11} style={styles.srcText}>
            来源 · X
          </Mono>
        </View>
        {dateLabel ? (
          <Mono size={11} style={styles.srcDate}>
            {dateLabel}
          </Mono>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: theme.color.paper,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: 16,
    padding: 18,
    overflow: "hidden",
    boxShadow: "0px 6px 16px rgba(0,0,0,0.07)",
  },
  top: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  categoryPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink3,
    borderRadius: 999,
    paddingHorizontal: 9,
    paddingVertical: 2,
  },
  categoryText: {
    color: theme.color.ink2,
  },
  time: {
    color: theme.color.muted2,
  },
  author: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9,
    marginTop: 12,
  },
  avatar: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: theme.color.paper3,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: {
    color: theme.color.ink2,
  },
  authorMeta: {
    flex: 1,
  },
  name: {
    color: theme.color.ink,
    lineHeight: 18,
  },
  handle: {
    color: theme.color.muted,
    marginTop: 1,
  },
  eyebrow: {
    color: theme.color.muted,
    letterSpacing: 1,
    marginTop: 13,
  },
  headline: {
    color: theme.color.ink,
    marginTop: 7,
  },
  snip: {
    marginTop: 10,
    paddingHorizontal: 11,
    paddingVertical: 8,
    backgroundColor: theme.color.paper2,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.rule,
    borderRadius: 4,
  },
  snipLabel: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  snipText: {
    color: theme.color.ink2,
    lineHeight: 19,
  },
  tagRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  assetRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
    marginTop: 12,
  },
  assetChip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  assetChipTracked: {
    borderColor: theme.color.green,
  },
  assetName: {
    color: theme.color.ink2,
  },
  assetCode: {
    color: theme.color.muted2,
  },
  assetTracked: {
    color: theme.color.green,
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
  mediaMark: {
    color: theme.color.muted2,
  },
  aiReading: {
    color: theme.color.muted2,
    fontStyle: "italic",
  },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: 11,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  srcLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  srcMark: {
    width: 16,
    height: 16,
    borderRadius: 4,
    backgroundColor: theme.color.ink,
    alignItems: "center",
    justifyContent: "center",
  },
  srcMarkText: {
    color: theme.color.paper,
  },
  srcText: {
    color: theme.color.muted,
  },
  srcDate: {
    color: theme.color.muted2,
  },
});
