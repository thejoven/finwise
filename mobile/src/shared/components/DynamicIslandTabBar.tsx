import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { haptic } from "@/core/haptics";
import { theme } from "@/core/theme";
import { BottomCategoryCell } from "@/features/project";

import { IslandGlass, PILL_HEIGHT, PILL_RADIUS, glassOverlay } from "./glass";

/**
 * 底部栏 — 两颗分离的玻璃胶囊 (液态玻璃).
 *
 * 形态: 一行里并排两颗悬浮玻璃药丸, 中间留缝、互不相连:
 *   · 左「分类格」(BottomCategoryCell): 当前分类 + ▴, 点击向上弹分类下拉框.
 *   · 右「tab 岛」: 五个 tab —— **上图标下文字**, 标签常驻可见.
 *   整行水平居中悬浮, 脱离屏幕边缘. 分类从报头挪到这里 (见 GOAL 本轮调整).
 *
 * 切换特效 (两段叠加, 利落不喧闹):
 *   1) 一颗"透镜"高亮 (highlight) 用弹簧滑到选中格底下 —— tab 等宽 (TAB_WIDTH) 故位置可
 *      直接算: translateX = index × (TAB_WIDTH + TAB_GAP), 无需 onLayout 量.
 *   2) 选中那一刻图标轻轻一"弹" (scale 1→1.14→1), 由 TabButton 各自持有的 sharedValue 驱动.
 *
 * 材质: iOS 26+ 走 GlassView (liquid glass), 以下 / Android 降级 BlurView —— 收在
 *   `./glass` 的 `IslandGlass`, 两颗胶囊共用, 长成一对. 图标/标签直接用 theme.color
 *   的动态色 (随明暗自动翻); 描边/高亮这类非调色板 rgba 走 `glassOverlay`.
 *
 * 为什么走自定义 `tabBar`: 悬浮胶囊要自控位置/形状/动画, 且要在 tab 左侧塞一颗独立分类格,
 *   默认 bar 给不了. 自定义 tabBar 下, screenOptions 的 tabBarStyle / tint 等全部失效.
 *
 * 高度账: host bottom = insets.bottom + sm(8); 胶囊高 = PILL_HEIGHT(52). 故岛顶距屏底 =
 *   insets.bottom + 60, 仍在各 tab 屏 `insets.bottom + 64` 的留白内 —— 无需改动各屏 paddingBottom.
 *
 * 触感: 切 tab 走 selection 触感 (haptic.selection), 见 references/06-haptic-grammar.md.
 *
 * @see ./glass
 * @see BottomCategoryCell
 * @see https://reactnavigation.org/docs/bottom-tab-navigator/#tabbar
 */

// ── tab 岛几何 (等宽栅格, 让滑动高亮可直接算出落点) ────────────────────
const TAB_WIDTH = 44;
const TAB_HEIGHT = 44;
const TAB_GAP = theme.spacing.xxs; // 2 —— 格与格之间
const ISLAND_PAD = theme.spacing.xs; // 4 —— 岛内左右留白
/** 高亮滑动的弹簧手感 —— 利落但不生硬. */
const SLIDE = { damping: 18, stiffness: 220, mass: 0.7 };
/** 选中"透镜"相对格子内缩一圈 —— 留出呼吸, 看着像悬浮的玻璃镜片而非铺满的方块. */
const LENS_INSET = 2;

/** route name → 图标 + 标签. 顺序/键名必须与 `(tabs)/_layout.tsx` 的 <Tabs.Screen> 一致. */
type TabMeta = { icon: SFSymbol; iconSelected: SFSymbol; label: string };
const TAB_META: Record<string, TabMeta> = {
  inbox: { icon: "tray", iconSelected: "tray.fill", label: "收件箱" },
  signals: { icon: "square.stack", iconSelected: "square.stack.fill", label: "降噪" },
  archive: { icon: "archivebox", iconSelected: "archivebox.fill", label: "档案" },
  attention: {
    icon: "chart.line.uptrend.xyaxis",
    iconSelected: "chart.line.uptrend.xyaxis",
    label: "统计",
  },
  profile: { icon: "person", iconSelected: "person.fill", label: "我" },
};

/** 单个 tab —— 上图标下文字. 选中时图标轻弹一下 (各自持 sharedValue, 故抽成组件挂 hook). */
function TabButton({
  meta,
  focused,
  onPress,
  onLongPress,
}: {
  meta: TabMeta;
  focused: boolean;
  onPress: () => void;
  onLongPress: () => void;
}) {
  const pop = useSharedValue(1);
  useEffect(() => {
    if (focused) {
      pop.value = withSequence(
        withTiming(1.14, { duration: 130, easing: Easing.out(Easing.cubic) }),
        withSpring(1, { damping: 10, stiffness: 180 }),
      );
    }
  }, [focused, pop]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={meta.label}
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
    >
      <Animated.View style={iconStyle}>
        <SymbolView
          name={focused ? meta.iconSelected : meta.icon}
          size={22}
          tintColor={focused ? theme.color.ink : theme.color.muted}
          resizeMode="scaleAspectFit"
        />
      </Animated.View>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={[styles.label, { color: focused ? theme.color.ink : theme.color.muted }]}
      >
        {meta.label}
      </Text>
    </Pressable>
  );
}

export function DynamicIslandTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  const overlay = glassOverlay(isDark);

  // 高亮落点: 切 tab 时弹簧滑到新格 (初值即当前格, 故首帧不会从 0 滑过来).
  const activeX = useSharedValue(state.index);
  useEffect(() => {
    activeX.value = withSpring(state.index, SLIDE);
  }, [state.index, activeX]);
  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: activeX.value * (TAB_WIDTH + TAB_GAP) + LENS_INSET }],
  }));

  return (
    // host 满宽、绝对定位、不吃触摸 (box-none) —— 让胶囊两侧/下方的内容仍可点.
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + theme.spacing.sm }]}
    >
      <View pointerEvents="box-none" style={styles.row}>
        {/* 左: 独立分类格 (与右侧 tab 岛分离, 中间留缝). */}
        <BottomCategoryCell isDark={isDark} />

        {/* 右: tab 岛 —— 上图标下文字 + 滑动高亮. */}
        <View style={[styles.island, { borderColor: overlay.border }]}>
          <IslandGlass isDark={isDark} />
          <View style={styles.tabsRow}>
            {/* 透镜高亮: 无 padding 的 tabsRow 作参照系, left:0 即对齐第 0 格. */}
            <Animated.View
              pointerEvents="none"
              style={[
                styles.highlight,
                { backgroundColor: overlay.activeFill, borderColor: overlay.lensBorder },
                highlightStyle,
              ]}
            />
            {state.routes.map((route, index) => {
              const meta = TAB_META[route.name];
              if (!meta) return null;
              const focused = state.index === index;

              const onPress = () => {
                void haptic.selection();
                const event = navigation.emit({
                  type: "tabPress",
                  target: route.key,
                  canPreventDefault: true,
                });
                if (!focused && !event.defaultPrevented) {
                  navigation.navigate(route.name);
                }
              };

              const onLongPress = () => {
                navigation.emit({ type: "tabLongPress", target: route.key });
              };

              return (
                <TabButton
                  key={route.key}
                  meta={meta}
                  focused={focused}
                  onPress={onPress}
                  onLongPress={onLongPress}
                />
              );
            })}
          </View>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center", // 把整行胶囊水平居中
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm, // 两颗胶囊之间留缝 —— 分类格与 tab 岛不连在一起
    maxWidth: "100%",
    paddingHorizontal: theme.spacing.sm, // 窄屏不贴边
  },
  island: {
    alignItems: "center",
    justifyContent: "center",
    height: PILL_HEIGHT,
    paddingHorizontal: ISLAND_PAD,
    borderRadius: PILL_RADIUS, // 半高 = 左右两侧完全圆形
    borderWidth: StyleSheet.hairlineWidth,
    overflow: "hidden", // 把玻璃背景层裁进药丸形
  },
  tabsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: TAB_GAP,
    height: TAB_HEIGHT, // 无横向 padding —— 高亮的 left:0 即对齐第 0 格
  },
  highlight: {
    position: "absolute",
    left: 0,
    top: LENS_INSET,
    width: TAB_WIDTH - LENS_INSET * 2,
    height: TAB_HEIGHT - LENS_INSET * 2,
    borderRadius: theme.radius.lg, // 选中"透镜": 圆角镜片
    borderWidth: StyleSheet.hairlineWidth, // 一道极淡描边定边 (borderColor 内联随明暗)
  },
  tab: {
    alignItems: "center",
    justifyContent: "center",
    gap: 3, // 图标与文字之间 —— 给标签多一丝呼吸
    width: TAB_WIDTH,
    height: TAB_HEIGHT,
  },
  tabPressed: {
    opacity: 0.55, // 按下时整格轻轻一暗, 触觉之外再给一点视觉反馈
  },
  label: {
    fontFamily: theme.fontFamily.cjkBold, // 与报头主名"财知"同款 (NotoSerifSC Bold), 字体样式一致
    fontSize: 10,
    lineHeight: 13,
    letterSpacing: 0.5,
    includeFontPadding: false,
    // color 内联 (focused ? ink : muted) — 直接用 theme 动态色, 随明暗自动翻.
  },
});
