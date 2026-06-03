/**
 * 启动页 / Cover.
 *
 * 视觉沿用整本 App 的报刊语言 —
 *   · paper 底, 居中报刊头
 *   · 中文主名 "财知" (NotoSerifSC, 极大字号)
 *   · 英文副线 "FinWise" (Playfair Display italic)
 *   · slogan "以智驭财 · 行远致富"
 *   · 双横线分隔
 *   · 底部刊号小字
 *
 * 动画节奏 (总约 2.4s, 全部 native-driven via Reanimated 4):
 *   0.10s  双横线 scaleX 0 → 1 (从中心向两端展开)
 *   0.40s  主名 opacity 0 → 1, scale 0.94 → 1
 *   0.95s  副线 fade-up
 *   1.35s  slogan + 底栏 fade
 *   1.95s  整体 fade-out
 *   2.40s  onFinish() — 上层卸载本组件
 *
 * 用法: 由 <RootLayout> 在字体/state hydrate 完之后渲染一次, 动画完成后卸载.
 * 单次性: 没有 progress / skip — 这是品牌瞬间, 不是 onboarding.
 */

import { useEffect } from "react";
import { StyleSheet, Text as RNText, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";

import { Display, Sans } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";

export interface SplashCoverProps {
  /** 动画完整结束后回调. 上层用它把组件从树中卸载. */
  onFinish: () => void;
}

export function SplashCover({ onFinish }: SplashCoverProps) {
  const insets = useSafeAreaInsets();
  // Reanimated 的 Animated.View 不认 DynamicColorIOS 动态色, 根容器底色取 resolved hex.
  const c = useThemeColors();

  const ruleScale = useSharedValue(0);
  const nameOpacity = useSharedValue(0);
  const nameScale = useSharedValue(0.94);
  const sublineOpacity = useSharedValue(0);
  const sublineTranslate = useSharedValue(8);
  const taglineOpacity = useSharedValue(0);
  const rootOpacity = useSharedValue(1);

  useEffect(() => {
    const ease = Easing.out(Easing.cubic);

    ruleScale.value = withDelay(100, withTiming(1, { duration: 500, easing: ease }));

    nameOpacity.value = withDelay(400, withTiming(1, { duration: 600, easing: ease }));
    nameScale.value = withDelay(400, withTiming(1, { duration: 600, easing: ease }));

    sublineOpacity.value = withDelay(950, withTiming(1, { duration: 500, easing: ease }));
    sublineTranslate.value = withDelay(950, withTiming(0, { duration: 500, easing: ease }));

    taglineOpacity.value = withDelay(1350, withTiming(1, { duration: 500, easing: ease }));

    rootOpacity.value = withDelay(
      1950,
      withTiming(0, { duration: 420, easing: Easing.in(Easing.quad) }, (finished) => {
        if (finished) runOnJS(onFinish)();
      }),
    );
    // 单次入场 — 不依赖任何外部状态变化, 故 deps 留空.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rootStyle = useAnimatedStyle(() => ({ opacity: rootOpacity.value }));
  const ruleStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: ruleScale.value }],
    opacity: ruleScale.value,
  }));
  const nameStyle = useAnimatedStyle(() => ({
    opacity: nameOpacity.value,
    transform: [{ scale: nameScale.value }],
  }));
  const sublineStyle = useAnimatedStyle(() => ({
    opacity: sublineOpacity.value,
    transform: [{ translateY: sublineTranslate.value }],
  }));
  const taglineStyle = useAnimatedStyle(() => ({ opacity: taglineOpacity.value }));

  return (
    <Animated.View
      style={[
        styles.root,
        rootStyle,
        { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: c.paper },
      ]}
      pointerEvents="none"
    >
      <View style={styles.topMeta}>
        <Animated.View style={taglineStyle}>
          <Sans size={9} weight="600" style={styles.topMetaText}>
            VOL. I · NO. 0 · 创刊号
          </Sans>
        </Animated.View>
      </View>

      <View style={styles.center}>
        <Animated.View style={[styles.ruleWrap, ruleStyle]}>
          <View style={styles.rule} />
          <View style={styles.ruleGap} />
          <View style={styles.rule} />
        </Animated.View>

        <Animated.View style={nameStyle}>
          <RNText allowFontScaling={false} style={styles.nameplate}>
            财知
          </RNText>
        </Animated.View>

        <Animated.View style={sublineStyle}>
          <Display size={22} italic style={styles.subline}>
            FinWise
          </Display>
        </Animated.View>

        <Animated.View style={[styles.ruleWrap, styles.ruleWrapBottom, ruleStyle]}>
          <View style={styles.rule} />
        </Animated.View>

        <Animated.View style={taglineStyle}>
          <RNText allowFontScaling={false} style={styles.tagline}>
            以智驭财 · 行远致富
          </RNText>
        </Animated.View>
      </View>

      <Animated.View style={[styles.footer, taglineStyle]}>
        <Sans size={9} weight="600" style={styles.footerText}>
          A QUIET LEDGER · EST. MMXXVI
        </Sans>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    // backgroundColor 改为内联 resolved hex (见上) — Reanimated 不认动态色.
    zIndex: 100,
    elevation: 100,
  },
  topMeta: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    alignItems: "center",
  },
  topMetaText: {
    letterSpacing: 3,
    textTransform: "uppercase",
    color: theme.color.muted,
  },
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.lg,
  },
  ruleWrap: {
    width: 200,
    marginBottom: theme.spacing.lg,
  },
  ruleWrapBottom: {
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.md,
    width: 80,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ink,
  },
  ruleGap: { height: 2 },
  nameplate: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 72,
    lineHeight: 84,
    color: theme.color.ink,
    textAlign: "center",
    letterSpacing: 12,
    paddingLeft: 12,
  },
  subline: {
    color: theme.color.ink2,
    letterSpacing: 4,
    marginTop: theme.spacing.sm,
  },
  tagline: {
    fontFamily: theme.fontFamily.cjkRegular,
    fontSize: 12,
    lineHeight: 18,
    color: theme.color.muted,
    textAlign: "center",
    letterSpacing: 4,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    alignItems: "center",
  },
  footerText: {
    letterSpacing: 3,
    textTransform: "uppercase",
    color: theme.color.muted2,
  },
});
