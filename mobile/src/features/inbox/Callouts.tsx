/**
 * Inbox 顶部的"AI 找你"区域.
 *
 * 三种卡 (按优先级, 同时只显示最相关一张):
 *   1. retrospect pending → "持仓 X 到期 · 一起复盘"
 *   2. commitment status=drafted → "AI 给你写了一份承诺书 · 等你签字"
 *   3. companion (今日焦虑卡) → 当 commitment.signed + 今日 opens >= 3 后由后端发出
 *
 * 不显示 = 安静. 这是产品哲学的关键: AI 不主动找你, 它在你打开 APP 时已经"准备好了".
 */

import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

import { useActiveCommitment } from "@/features/commitment";
import { useRetrospectList } from "@/features/retrospect";

export function InboxCallouts() {
  const { data: commitment } = useActiveCommitment();
  const { data: retrospects } = useRetrospectList();

  const pendingRetrospect = retrospects?.find((r) => r.state === "pending" || r.state === "in_progress");
  const draftedCommitment = commitment?.status === "drafted" ? commitment : null;

  // 优先级: pending retrospect > drafted commitment > 无
  if (pendingRetrospect) {
    return (
      <Callout
        stamp="复盘"
        title="持仓到期 · 一起复盘"
        subtitle="四个问题, 不打分, 看见自己."
        onPress={() => router.push(`/retrospect/${pendingRetrospect.id}`)}
      />
    );
  }

  if (draftedCommitment) {
    return (
      <Callout
        stamp="承诺书"
        title="AI 给你写了一份承诺书"
        subtitle={`${draftedCommitment.thesis.asset_name} · ${draftedCommitment.thesis.position_pct.toFixed(0)}% · ${draftedCommitment.thesis.duration_months} 个月`}
        onPress={() => router.push(`/commitment/${draftedCommitment.id}`)}
      />
    );
  }

  return null;
}

interface CalloutProps {
  stamp: string;
  title: string;
  subtitle: string;
  onPress: () => void;
}

function Callout({ stamp, title, subtitle, onPress }: CalloutProps) {
  return (
    <TapEffect style={styles.card} pressedStyle={{ backgroundColor: theme.color.paperPressed }} onPress={onPress}>
      <View style={styles.rule} />
      <Mono size={9} style={styles.stamp}>
        {stamp.toUpperCase()} · 一封信
      </Mono>
      <Serif size={18} style={styles.title}>
        {title}
      </Serif>
      <Sans size={11} weight="500" style={styles.subtitle}>
        {subtitle}
      </Sans>
      <View style={styles.rule} />
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  card: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    backgroundColor: theme.color.paper2,
  },
  rule: {
    height: 1,
    backgroundColor: theme.color.ink,
    marginVertical: theme.spacing.sm,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
  },
  title: {
    color: theme.color.ink,
    marginTop: 4,
    marginBottom: 4,
  },
  subtitle: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
});
