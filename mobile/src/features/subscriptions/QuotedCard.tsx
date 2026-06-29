import { memo } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { Image } from "expo-image";
import { useTranslation } from "react-i18next";

import { Mono, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type { QuotedTweet } from "@/core/api/subscriptions";

/**
 * QuotedCard — 转帖原文 (引用推文被引、或纯转推被转的原推).
 *
 * 报刊式内嵌引文, 不是社交转推卡: 左侧竖线 + 原作者 + 原文 + 媒体标记.
 *   - compact (feed 行): 无头像, 正文 clamp 3 行, 不可点 (整行点击进详情).
 *   - 详情: 显示头像, 正文不截断, 点击去 X 看原文.
 */
export const QuotedCard = memo(function QuotedCard({
  quoted,
  compact = false,
}: {
  quoted: QuotedTweet;
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const media = quoted.media ?? [];
  const hasPhoto = media.some((m) => m.type === "photo");
  const hasVideo = media.some((m) => m.type !== "photo");

  const body = (
    <View style={styles.card}>
      <View style={styles.head}>
        {!compact && quoted.avatar_url ? (
          <Image source={{ uri: quoted.avatar_url }} style={styles.avatar} />
        ) : null}
        <Mono size={10} style={styles.meta} numberOfLines={1}>
          {t("subscriptions.quoted.label")} · {quoted.display_name || quoted.handle} · @
          {quoted.handle}
        </Mono>
      </View>

      <Serif
        size={compact ? 12 : 14}
        style={styles.text}
        numberOfLines={compact ? 3 : undefined}
      >
        {quoted.text}
      </Serif>

      {hasPhoto || hasVideo ? (
        <View style={styles.mediaRow}>
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
        </View>
      ) : null}

      {!compact ? (
        <Mono size={10} style={styles.openLink}>
          {t("subscriptions.quoted.openOnX")}
        </Mono>
      ) : null}
    </View>
  );

  if (compact) return body;
  return (
    <TapEffect onPress={() => void Linking.openURL(`https://x.com/i/status/${quoted.id}`)}>
      {body}
    </TapEffect>
  );
});

const styles = StyleSheet.create({
  card: {
    borderLeftWidth: 2,
    borderLeftColor: theme.color.rule,
    paddingLeft: theme.spacing.md,
    gap: 4,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  avatar: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: theme.color.paper3,
  },
  meta: {
    color: theme.color.muted,
    flex: 1,
  },
  text: {
    color: theme.color.ink2,
    lineHeight: 20,
  },
  mediaRow: {
    flexDirection: "row",
    gap: 6,
  },
  mediaMark: {
    color: theme.color.muted2,
  },
  openLink: {
    color: theme.color.muted,
    marginTop: 2,
  },
});
