import { useEffect, useRef, useState } from "react";
import { Linking, ScrollView, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import { DoubleRule, Icon, Mono, Sans, SectionHeader, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { formatShortDateTime } from "@/shared/format";
import { PromoteSheet } from "@/features/subscriptions/PromoteSheet";
import { useMarkTweetRead, useTweetDetail } from "@/features/subscriptions/hooks";

/**
 * 推文详情 — 订阅 feed 点进来 (UX 规格 §8.4).
 *
 * 报刊版式: back + stamp → 作者块 → 全文 (当文章排) → 媒体 → AI 编辑块 → 动作区.
 * 进入即已读 (乐观更新, 无需手点). 转为信号走 PromoteSheet (§8.5).
 */
export default function TweetDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: tweet, isLoading, isError } = useTweetDetail(id);
  const markRead = useMarkTweetRead();
  const [promoteOpen, setPromoteOpen] = useState(false);

  // 进入即已读 — 只在首次拿到未读数据时打一次.
  const markedRef = useRef(false);
  useEffect(() => {
    if (tweet && !tweet.read && !markedRef.current) {
      markedRef.current = true;
      markRead.mutate(tweet.id);
    }
  }, [tweet, markRead]);

  const openInX = () => {
    if (!id) return;
    void Linking.openURL(`https://x.com/i/status/${id}`);
  };

  const photos = (tweet?.media ?? []).filter((m) => m.type === "photo");
  const videos = (tweet?.media ?? []).filter((m) => m.type !== "photo");

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.header}>
        <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
          <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
          <Serif size={13}>{t("common.back")}</Serif>
        </TapEffect>
        <Sans size={9} weight="600" style={styles.headerStamp}>
          {t("subscriptions.detail.stamp")}
          {tweet ? ` · @${tweet.handle}` : ""}
        </Sans>
        <View style={styles.headerSpacer} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading ? (
          <Serif size={13} italic style={styles.mutedText}>
            {t("subscriptions.detail.loading")}
          </Serif>
        ) : isError || !tweet ? (
          <Serif size={13} italic style={styles.mutedText}>
            {t("subscriptions.detail.notFound")}
          </Serif>
        ) : (
          <View style={styles.body}>
            {/* ── 作者块 ── */}
            <View style={styles.authorRow}>
              {tweet.avatar_url ? (
                <Image source={{ uri: tweet.avatar_url }} style={styles.avatar} />
              ) : (
                <View style={[styles.avatar, styles.avatarFallback]} />
              )}
              <View style={styles.authorCol}>
                <Sans size={14} weight="600" style={styles.authorName}>
                  {tweet.display_name || tweet.handle}
                </Sans>
                <Mono size={10} style={styles.authorMeta}>
                  {tweet.is_retweet ? t("subscriptions.detail.retweet") : ""}@{tweet.handle} ·{" "}
                  {formatShortDateTime(tweet.tweet_created_at)}
                </Mono>
              </View>
            </View>

            {/* ── 全文 (当文章排, 不当推文排) ── */}
            <Serif size={17} style={styles.fullText}>
              {tweet.text}
            </Serif>

            {/* ── 媒体 ── */}
            {photos.map((m) => (
              <Image
                key={m.url}
                source={{ uri: m.url }}
                style={[
                  styles.photo,
                  { aspectRatio: m.width && m.height ? m.width / m.height : 16 / 9 },
                ]}
                contentFit="cover"
              />
            ))}
            {videos.map((m) => (
              <TapEffect key={m.url} onPress={openInX} style={styles.videoWrap}>
                {m.thumb ? (
                  <Image
                    source={{ uri: m.thumb }}
                    style={[styles.photo, styles.videoThumb]}
                    contentFit="cover"
                  />
                ) : (
                  <View style={[styles.photo, styles.videoThumb, styles.avatarFallback]} />
                )}
                <View style={styles.playBadge}>
                  <Sans size={11} weight="600" style={styles.playText}>
                    {t("subscriptions.detail.playOnX")}
                  </Sans>
                </View>
              </TapEffect>
            ))}

            {/* ── AI 编辑块 ── */}
            <View style={styles.aiBlock}>
              <DoubleRule />
              <View style={styles.aiInner}>
                <SectionHeader label={t("subscriptions.detail.aiEditor")} meta={tweet.category ?? ""} />
                {tweet.summary ? (
                  <Serif size={13} italic style={styles.summary}>
                    {tweet.summary}
                  </Serif>
                ) : tweet.classify_status === "pending" ? (
                  <Mono size={10} style={styles.aiPending}>
                    {t("subscriptions.detail.aiPending")}
                  </Mono>
                ) : null}
                {(tweet.tags ?? []).length > 0 ? (
                  <View style={styles.tagRow}>
                    {(tweet.tags ?? []).map((tag) => (
                      <View key={tag} style={styles.pill}>
                        <Sans size={9} style={styles.pillText}>
                          {tag}
                        </Sans>
                      </View>
                    ))}
                  </View>
                ) : null}
              </View>
            </View>

            {/* ── 动作区 ── */}
            <View style={styles.actions}>
              <TapEffect onPress={() => setPromoteOpen(true)} style={styles.primaryBtn}>
                <Sans size={13} weight="600" style={styles.primaryText}>
                  {t("subscriptions.detail.promote")}
                </Sans>
              </TapEffect>
              <TapEffect onPress={openInX} style={styles.secondaryBtn}>
                <Sans size={13} weight="600" style={styles.secondaryText}>
                  {t("subscriptions.detail.openOnX")}
                </Sans>
              </TapEffect>
            </View>
          </View>
        )}
      </ScrollView>

      {tweet ? (
        <PromoteSheet tweet={tweet} visible={promoteOpen} onClose={() => setPromoteOpen(false)} />
      ) : null}
    </SafeAreaView>
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
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    flex: 1,
  },
  headerStamp: {
    color: theme.color.muted,
    letterSpacing: 1.5,
  },
  headerSpacer: {
    flex: 1,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxxl,
  },
  mutedText: {
    color: theme.color.muted,
  },
  body: {
    gap: theme.spacing.md,
  },
  authorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  avatarFallback: {
    backgroundColor: theme.color.paper3,
  },
  authorCol: {
    flex: 1,
    gap: 2,
  },
  authorName: {
    color: theme.color.ink,
  },
  authorMeta: {
    color: theme.color.muted,
  },
  fullText: {
    color: theme.color.ink,
    lineHeight: 28,
  },
  photo: {
    width: "100%",
    borderRadius: theme.radius.md,
    backgroundColor: theme.color.paper3,
  },
  videoWrap: {
    position: "relative",
  },
  videoThumb: {
    aspectRatio: 16 / 9,
  },
  playBadge: {
    position: "absolute",
    bottom: theme.spacing.sm,
    left: theme.spacing.sm,
    backgroundColor: "rgba(0,0,0,0.6)",
    borderRadius: 999,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 4,
  },
  playText: {
    color: "#ffffff",
  },
  aiBlock: {
    marginTop: theme.spacing.sm,
  },
  aiInner: {
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  summary: {
    color: theme.color.ink2,
    lineHeight: 22,
  },
  aiPending: {
    color: theme.color.muted2,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 6,
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
  actions: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.md,
  },
  primaryBtn: {
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  primaryText: {
    color: theme.color.paper,
  },
  secondaryBtn: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink2,
    borderRadius: theme.radius.md,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  secondaryText: {
    color: theme.color.ink,
  },
});
