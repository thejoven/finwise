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

import { useEffect } from "react";
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

import { Mono } from "@/shared/components";
import { theme } from "@/core/theme";

import { TypewriterText } from "./TypewriterText";

interface Props {
  /** 显示在顶部小字, 例 "AWAITING · ROUND 2" */
  stamp?: string;
  /** 主体 typewriter 文字 */
  text: string;
}

export function WaitingForNext({ stamp, text }: Props) {
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
});
