/**
 * 可折叠版报刊头. 跟 Masthead 视觉一样, 多一项: 跟着外部 scrollY 平滑折叠.
 *
 * 状态机:
 *   · scrollY = 0           完整展开. 顶条 + 财知 + FinWise + slogan + 双横线.
 *   · scrollY in [0, RANGE] 主名 / 副线 / slogan 同步 fade + 上移; 容器高度收紧.
 *   · scrollY >= RANGE      折叠态. 只剩顶条 (VOL · NO · 日期 · 周几) + 左 ≡ + 右 ＋.
 *
 * 用法 (inbox / archive 共享):
 *   const scrollY = useSharedValue(0);
 *   const onScroll = useAnimatedScrollHandler({ onScroll: e => { scrollY.value = e.contentOffset.y } });
 *   <Animated.FlatList onScroll={onScroll} scrollEventThrottle={16}
 *     contentContainerStyle={{ paddingTop: COLLAPSIBLE_MASTHEAD_EXPANDED + insets.top, ... }} />
 *   <CollapsibleMasthead scrollY={scrollY} ... />  // 自带 absolute 浮层
 *
 * 字体例外: 主名"财知"直接用 RNText + NotoSerifSC, 不走 Display 组件 ——
 * Display 是 Playfair Display 西文族, 中文会 fallback 到系统字体, 失去报刊感.
 */

import { StyleSheet, Text as RNText, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BookOpen, Plus } from "lucide-react-native";

import { Display, Sans } from "./Text";
import { TapEffect } from "./TapEffect";
import { theme } from "@/core/theme";
import { ProjectChipsRow } from "@/features/project";

export interface CollapsibleMastheadProps {
  volume: string;
  edition: string;
  date: string;
  weekday: string;
  onMenuPress?: () => void;
  onCapturePress?: () => void;
  /** 外部 ScrollView 的滚动位移 (px, 单调非负 clamp 由本组件自行做). */
  scrollY: SharedValue<number>;
}

// ── 静态高度常量 (不含 safe-area top inset) ─────────────────────────────
// 顶条本身的高度: icon 28 + 顶部内边距 8 + 底部 4 ≈ 40
const TOP_BAR_BLOCK = 40;
// "财知 + FinWise + slogan" 块的高度
const HERO_BLOCK = 48 + 2 + 16 + 6 + 16 + 6; // ≈ 94
// 分类 chip 行: paddingTop 4 + 24 chip + paddingBottom 6 ≈ 34
const CHIPS_BLOCK = 34;
// 折叠态可见的 + 展开时一起被收掉的 hero + chips 总高
const COLLAPSING_BLOCK = HERO_BLOCK + CHIPS_BLOCK;
// 底部 rule (折叠态: 单线; 展开态: 双线)
const FOOTER_BLOCK = 6;

/** 展开态总高度 (不含 safe top). 父组件用作 ScrollView paddingTop 基准. */
export const COLLAPSIBLE_MASTHEAD_EXPANDED = TOP_BAR_BLOCK + COLLAPSING_BLOCK + FOOTER_BLOCK;
/** 折叠态总高度 (不含 safe top). */
export const COLLAPSIBLE_MASTHEAD_COLLAPSED = TOP_BAR_BLOCK + FOOTER_BLOCK; // ~46

/** 折叠动画走完所需的 scrollY 距离. 等于 hero+chips 块高度, 视觉与滚动 1:1. */
const RANGE = COLLAPSING_BLOCK;

export function CollapsibleMasthead({
  volume,
  edition,
  date,
  weekday,
  onMenuPress,
  onCapturePress,
  scrollY,
}: CollapsibleMastheadProps) {
  const insets = useSafeAreaInsets();

  // 容器高度: 展开总高 → 折叠总高 (线性插值, 含 safe top inset).
  const containerStyle = useAnimatedStyle(() => {
    const extra = interpolate(scrollY.value, [0, RANGE], [COLLAPSING_BLOCK, 0], Extrapolation.CLAMP);
    return {
      height: insets.top + TOP_BAR_BLOCK + extra + FOOTER_BLOCK,
    };
  });

  // hero 块: 整体 opacity + translateY (折叠时上移并淡出).
  const heroStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, RANGE * 0.55], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [0, RANGE], [0, -16], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  return (
    <Animated.View style={[styles.root, { paddingTop: insets.top }, containerStyle]}>
      <View style={styles.topRow}>
        <TapEffect
          onPress={onMenuPress}
          style={styles.iconButton}
          disabled={!onMenuPress}
          disableEffect={!onMenuPress}
          accessibilityLabel="卷首语 · 关于本刊"
        >
          <BookOpen
            size={18}
            color={onMenuPress ? theme.color.ink : theme.color.muted2}
            strokeWidth={1.5}
          />
        </TapEffect>
        <Sans size={9} weight="600" style={styles.topStrip}>
          VOL. {volume} · NO. {edition} · {date} · {weekday}
        </Sans>
        <TapEffect
          onPress={onCapturePress}
          style={styles.iconButton}
          disabled={!onCapturePress}
          disableEffect={!onCapturePress}
          accessibilityLabel="记录新观察"
        >
          <Plus
            size={20}
            color={onCapturePress ? theme.color.ink : theme.color.muted2}
            strokeWidth={1.75}
          />
        </TapEffect>
      </View>

      {/* Hero: 折叠时整块淡出. pointerEvents=none 避免折叠后仍捕获点击. */}
      <Animated.View style={[styles.hero, heroStyle]} pointerEvents="none">
        <RNText allowFontScaling={false} style={styles.nameplateCJK}>
          财知
        </RNText>
        <Display size={14} italic style={styles.subline}>
          FinWise
        </Display>
        <RNText maxFontSizeMultiplier={1.2} style={styles.tagline}>
          以智驭财 · 行远致富
        </RNText>
      </Animated.View>

      {/* 分类 chip 行: 容器高度收紧时自动被截掉, 不需要单独的 opacity 动画. */}
      <Animated.View style={heroStyle}>
        <ProjectChipsRow parentPadded />
      </Animated.View>

      {/* 双横线 (展开时显双线; 折叠时被容器高度截掉, 只剩外层 hairline 收边) */}
      <View style={styles.rule} />
      <View style={styles.ruleGap} />
      <View style={styles.rule} />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: theme.color.paper,
    overflow: "hidden",
    zIndex: 10,
    paddingHorizontal: theme.spacing.lg,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    height: TOP_BAR_BLOCK - 4,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  topStrip: {
    flex: 1,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
    textAlign: "center",
  },
  hero: {
    alignItems: "center",
  },
  nameplateCJK: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 42,
    lineHeight: 48,
    color: theme.color.ink,
    textAlign: "center",
    letterSpacing: 6,
    paddingLeft: 6,
    marginBottom: 2,
  },
  subline: {
    textAlign: "center",
    color: theme.color.ink2,
    letterSpacing: 2,
    marginBottom: 6,
  },
  tagline: {
    fontFamily: theme.fontFamily.cjkRegular,
    fontSize: 11,
    lineHeight: 16,
    color: theme.color.muted,
    textAlign: "center",
    letterSpacing: 3,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ink,
  },
  ruleGap: {
    height: 2,
  },
});
