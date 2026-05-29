/**
 * WaitingForNext — 等下一题时的占位 + 微动画.
 *
 * 三层节奏 (符合报刊感, 不用 spinner):
 *   1. Mono stamp "AWAITING · ROUND N" — 顶部小字, letter-spacing 2
 *   2. TypewriterText 字句, 一句话 (复用现有)
 *   3. 三个 dot 顺序 pulse + 一条 ink 细线 shimmer 从左滑到右 (Reanimated)
 *
 * 不破坏现有 TypewriterText, 这里 wrap 它.
 *
 * 设计准则:
 *   - 不用 ActivityIndicator (项目刻意约束)
 *   - 动画 1.6s 一个周期, 永远循环, 不爆 CPU
 *   - 用 ink/muted 色调, 不引入新色
 */

import { useEffect, useState } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

import { TypewriterText } from "./TypewriterText";

interface Props {
  /** 显示在顶部小字, 例 "AWAITING · ROUND 2" */
  stamp?: string;
  /** 主体 typewriter 文字 */
  text: string;
  /**
   * 可选: 等下一题的计时锚 (上一轮 answered_at). 配合 onRetry 启用 60s 后的
   * 重试按钮. 不传 → 永远不显示重试.
   */
  retryAnchor?: string | number | null;
  /** 重试 mutation 回调; 同时控制 busy 视觉 */
  onRetry?: () => void;
  retryBusy?: boolean;
}

export function WaitingForNext({ stamp, text, retryAnchor, onRetry, retryBusy }: Props) {
  return (
    <View style={styles.root}>
      {stamp ? (
        <Mono size={9} style={styles.stamp}>
          {stamp}
        </Mono>
      ) : null}
      <TypewriterText text={text} style={styles.body} />
      <View style={styles.dotRow}>
        <PulsingDot delay={0} />
        <PulsingDot delay={180} />
        <PulsingDot delay={360} />
      </View>
      <ShimmerRule />
      {retryAnchor != null && onRetry ? (
        <RetryGate anchor={retryAnchor} busy={!!retryBusy} onRetry={onRetry} />
      ) : null}
    </View>
  );
}

/**
 * RetryGate — 60s 后才露面的"重新出题"提示 + 按钮.
 * 包在 WaitingForNext 内部, 跟"等下一题"语义一致.
 */
function RetryGate({
  anchor,
  busy,
  onRetry,
}: {
  anchor: string | number;
  busy: boolean;
  onRetry: () => void;
}) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const anchorMs = typeof anchor === "number" ? anchor : new Date(anchor).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - anchorMs) / 1000));
  if (elapsedSec < 60) return null;

  return (
    <View style={styles.retryBlock}>
      <Serif size={12} italic style={styles.retryHint}>
        ◆ 等下一题超过 {elapsedSec}s — 大概率 Socratic 输出格式偶发不稳, 让它重试一次.
      </Serif>
      <TapEffect
        style={[styles.retryButton, busy && styles.retryButtonBusy]}
        pressedStyle={busy ? undefined : { backgroundColor: theme.color.ink2 }}
        onPress={busy ? undefined : onRetry}
        disabled={busy}
      >
        <Sans size={11} weight="700" style={styles.retryLabel}>
          {busy ? "正在重新出题..." : "让它再出一次"}
        </Sans>
      </TapEffect>
    </View>
  );
}

function PulsingDot({ delay }: { delay: number }) {
  const opacity = useSharedValue(0.2);

  useEffect(() => {
    opacity.value = withDelay(
      delay,
      withRepeat(
        withSequence(
          withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) }),
          withTiming(0.2, { duration: 600, easing: Easing.in(Easing.cubic) }),
        ),
        -1,
        false,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [delay, opacity]);

  const animStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));
  return <Animated.View style={[styles.dot, animStyle]} />;
}

/** ink 细线 shimmer 从左滑到右, 1.6s 周期. */
function ShimmerRule() {
  const tx = useSharedValue(-100);

  useEffect(() => {
    tx.value = withRepeat(
      withTiming(220, { duration: 1600, easing: Easing.inOut(Easing.cubic) }),
      -1,
      false,
    );
    return () => cancelAnimation(tx);
  }, [tx]);

  const animStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }] }));

  return (
    <View style={styles.ruleTrack}>
      <Animated.View style={[styles.ruleSlide, animStyle]} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xxl,
    paddingBottom: theme.spacing.xxl,
    gap: theme.spacing.md,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  body: {
    color: theme.color.muted,
    fontSize: 15,
    lineHeight: 24,
  },
  dotRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.sm,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.ink,
  },
  ruleTrack: {
    marginTop: theme.spacing.md,
    height: StyleSheet.hairlineWidth,
    overflow: "hidden",
    backgroundColor: theme.color.ruleSoft,
  },
  ruleSlide: {
    width: 80,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ink,
  },
  retryBlock: {
    marginTop: theme.spacing.lg,
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  retryHint: {
    color: theme.color.muted,
    lineHeight: 20,
  },
  retryButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.color.ink,
  },
  retryButtonBusy: {
    backgroundColor: theme.color.muted2,
  },
  retryLabel: {
    color: theme.color.paper,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
});
