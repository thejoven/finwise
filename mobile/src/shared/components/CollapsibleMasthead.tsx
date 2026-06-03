/**
 * 可折叠版报刊头. 跟 Masthead 视觉一脉相承, 多一项: 跟着外部 scrollY 平滑折叠.
 *
 * 状态机:
 *   · scrollY = 0           完整展开. 顶条 + 刊名"财知" + FinWise + slogan + 双横线.
 *   · scrollY in [0, RANGE] FinWise / slogan 同步 fade + 上移; 容器高度收紧.
 *   · scrollY >= RANGE      折叠态. 顶条 + 刊名"财知" + 单收边线常驻.
 *
 * 刊名"财知"这一行**常驻不折叠**, 顶部始终能看到. 分类切换已挪到底栏的独立分类格
 * (见 BottomCategoryCell), 报头不再带 "· 分类名 ▾". 只有装饰性的 FinWise / slogan
 * 副线随滚动收起.
 *
 * 用法 (inbox / archive 共享):
 *   const scrollY = useSharedValue(0);
 *   const onScroll = useAnimatedScrollHandler({ onScroll: e => { scrollY.value = e.contentOffset.y } });
 *   <Animated.FlatList onScroll={onScroll} scrollEventThrottle={16}
 *     contentContainerStyle={{ paddingTop: COLLAPSIBLE_MASTHEAD_EXPANDED + insets.top, ... }} />
 *   <CollapsibleMasthead scrollY={scrollY} ... />  // 自带 absolute 浮层
 */

import { StyleSheet, Text as RNText, View } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedStyle,
  type SharedValue,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Icon } from "./Icon";
import { Display, Sans } from "./Text";
import { TapEffect } from "./TapEffect";
import { theme, useThemeColors } from "@/core/theme";

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
// 常驻的刊名"财知"一行: paddingVertical 6 + lineHeight 28 + 6 ≈ 40
const NAMEPLATE_BLOCK = 40;
// 折叠时收起的副线块: FinWise (≈18) + 间距 6 + slogan (16) + 上边距 4 ≈ 44
const SUBLINE_BLOCK = 44;
// 展开时一起被收掉的部分 (仅副线; 顶条与分类行常驻)
const COLLAPSING_BLOCK = SUBLINE_BLOCK;
// 收底线用 root 的 borderBottom 常驻 (折叠/展开都贴在容器下沿), 不占 flow 高度.

/** 展开态总高度 (不含 safe top). 父组件用作 ScrollView paddingTop 基准. */
export const COLLAPSIBLE_MASTHEAD_EXPANDED = TOP_BAR_BLOCK + NAMEPLATE_BLOCK + COLLAPSING_BLOCK;
/** 折叠态总高度 (不含 safe top): 顶条 + 分类行常驻. */
export const COLLAPSIBLE_MASTHEAD_COLLAPSED = TOP_BAR_BLOCK + NAMEPLATE_BLOCK;

/** 折叠动画走完所需的 scrollY 距离. 等于副线块高度, 视觉与滚动 1:1. */
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
  // Reanimated 的 Animated.View 不认 DynamicColorIOS 动态色, 故根容器底色取 resolved hex.
  const c = useThemeColors();

  // 容器高度: 展开总高 → 折叠总高 (线性插值, 含 safe top inset). 顶条 + 分类行常驻,
  // 只收 extra (副线块).
  const containerStyle = useAnimatedStyle(() => {
    const extra = interpolate(
      scrollY.value,
      [0, RANGE],
      [COLLAPSING_BLOCK, 0],
      Extrapolation.CLAMP,
    );
    return {
      height: insets.top + TOP_BAR_BLOCK + NAMEPLATE_BLOCK + extra,
    };
  });

  // 副线块: 整体 opacity + translateY (折叠时上移并淡出).
  const sublineStyle = useAnimatedStyle(() => {
    const opacity = interpolate(scrollY.value, [0, RANGE * 0.55], [1, 0], Extrapolation.CLAMP);
    const translateY = interpolate(scrollY.value, [0, RANGE], [0, -12], Extrapolation.CLAMP);
    return {
      opacity,
      transform: [{ translateY }],
    };
  });

  return (
    <Animated.View
      style={[
        styles.root,
        { paddingTop: insets.top, backgroundColor: c.paper, borderBottomColor: c.ink },
        containerStyle,
      ]}
    >
      <View style={styles.topRow}>
        <TapEffect
          onPress={onMenuPress}
          style={styles.iconButton}
          disabled={!onMenuPress}
          disableEffect={!onMenuPress}
          accessibilityLabel="卷首语 · 关于本刊"
        >
          <Icon
            name="book"
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
          <Icon
            name="plus"
            size={20}
            color={onCapturePress ? theme.color.ink : theme.color.muted2}
            strokeWidth={1.75}
          />
        </TapEffect>
      </View>

      {/* 常驻刊名 (不随滚动折叠). 分类切换已挪到底栏独立分类格, 这里只留刊名. */}
      <View style={styles.nameplateRow}>
        <RNText allowFontScaling={false} style={styles.nameplate}>
          财知
        </RNText>
      </View>

      {/* 副线: 折叠时整块淡出 + 上移. pointerEvents=none 避免折叠后仍捕获点击. */}
      <Animated.View style={[styles.sublines, sublineStyle]} pointerEvents="none">
        <Display size={14} italic style={styles.finwise}>
          FinWise
        </Display>
        <RNText maxFontSizeMultiplier={1.2} style={styles.tagline}>
          以智驭财 · 行远致富
        </RNText>
      </Animated.View>

      {/* 收底线由 root 的 borderBottom 常驻渲染 (见 styles.root) —— 折叠时也贴在下沿. */}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  root: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    // backgroundColor 改为内联 resolved hex (见上) — Reanimated 不认动态色.
    overflow: "hidden",
    zIndex: 10,
    paddingHorizontal: theme.spacing.lg,
    // 常驻收底线: 贴容器下沿, 折叠/展开都在 —— 分类行 sticky 时也有分隔线收边.
    // 颜色走内联 resolved hex (c.ink): Reanimated 的 Animated.View 不认 DynamicColorIOS 动态色.
    borderBottomWidth: StyleSheet.hairlineWidth,
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
  nameplateRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
  },
  nameplate: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 22,
    lineHeight: 28,
    color: theme.color.ink,
    letterSpacing: 3,
    paddingLeft: 3, // 抵消尾部 letterSpacing 让视觉居中
  },
  sublines: {
    alignItems: "center",
    marginTop: 2,
  },
  finwise: {
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
});
