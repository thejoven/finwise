import { useCallback, useEffect, useMemo } from "react";
import { Alert, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
// 本 App 刻意用自定义液态玻璃底栏 (本组件经 bottom-tabs 的 tabBar 注入), 而非原生 native-tabs
// —— 这是"灵动岛"产品设计 (融合玻璃 + 滑动透镜), 原生 tab 栏给不了. 故 rn-no-non-native-navigator 在此为有意为之.
// react-doctor-disable-next-line react-doctor/rn-no-non-native-navigator
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";

import { haptic } from "@/core/haptics";
import { theme } from "@/core/theme";
import { logout } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { BottomCategoryCell } from "@/features/project";
import { useCaizhiNav } from "@/features/caizhi/store";

import { TabBarGlass, PILL_HEIGHT, PILL_RADIUS } from "./glass";
import { glassOverlay } from "./glass-overlay";
import { TabContextMenu, type TabMenuActions } from "./TabContextMenu";

/**
 * 底部栏 — 两颗分离的玻璃胶囊 (液态玻璃).
 *
 * 形态: 一行里并排两颗悬浮玻璃药丸, 中间留缝、互不相连:
 *   · 左「分类格」(BottomCategoryCell): 当前分类 + ▴, 点击向上弹分类下拉框.
 *   · 右「tab 岛」: 四个 tab (报纸 · 财知 · 统计 · 我) —— **上图标下文字**, 标签常驻可见.
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
 * 长按: 每个 tab 各裹一层原生 ContextMenu (iOS 26 液态玻璃快捷菜单) —— 财知跳子页、统计刷新、
 *   我→编辑/密码/通知/退出. 收在 `./TabContextMenu`(.ios), @expo/ui 只在那个 .ios 文件里碰.
 *
 * @see ./glass
 * @see ./TabContextMenu
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
// 透镜几何 (相对岛框): 玻璃层是 absoluteFill, 故把 ISLAND_PAD/居中偏移直接折进静态落点;
//   滑动只剩纯 translateX = index × (TAB_WIDTH + TAB_GAP).
const LENS_W = TAB_WIDTH - LENS_INSET * 2;
const LENS_H = TAB_HEIGHT - LENS_INSET * 2;
const LENS_LEFT = ISLAND_PAD + LENS_INSET; // 对齐第 0 格的透镜左缘
const LENS_TOP = (PILL_HEIGHT - TAB_HEIGHT) / 2 + LENS_INSET; // tab 在胶囊内垂直居中 + 内缩
/** GlassContainer 融合距离: 透镜与胶囊在此距离内开始原生粘连/形变. 偏大=更易"相吸", 需上机调. */
const LENS_BLEND_SPACING = 18;

/** route name → 图标 + 标签. 顺序/键名必须与 `(tabs)/_layout.tsx` 的 <Tabs.Screen> 一致. */
type TabMeta = { icon: SFSymbol; iconSelected: SFSymbol; label: string };
const TAB_META: Record<string, TabMeta> = {
  newspaper: { icon: "newspaper", iconSelected: "newspaper.fill", label: "报纸" },
  caizhi: { icon: "books.vertical", iconSelected: "books.vertical.fill", label: "财知" },
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
  onPressIn,
  onPressOut,
}: {
  meta: TabMeta;
  focused: boolean;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const pop = useSharedValue(1);
  // focused 来自导航状态 (非本组件的本地事件): 程序化跳转 / 深链也会改它 —— "聚焦即弹一下"
  // 跟 focused 跑 effect 才对, 而非塞进某个 onPress. no-event-handler 在此为误报.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
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
      onPressIn={onPressIn}
      onPressOut={onPressOut}
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

  // 岛宽按等宽栅格算死 (tab 等宽, 故无需 onLayout 量): N 格 + 缝 + 左右留白.
  const tabCount = state.routes.reduce((n, r) => (TAB_META[r.name] ? n + 1 : n), 0);
  const islandWidth = tabCount * TAB_WIDTH + (tabCount - 1) * TAB_GAP + ISLAND_PAD * 2;

  // 高亮落点: 切 tab 时弹簧滑到新格 (初值即当前格, 故首帧不会从 0 滑过来). 静态偏移已折进
  //   LENS_LEFT/LENS_TOP, 这里只剩纯位移.
  const activeX = useSharedValue(state.index);
  useEffect(() => {
    activeX.value = withSpring(state.index, SLIDE);
  }, [state.index, activeX]);
  const highlightStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: activeX.value * (TAB_WIDTH + TAB_GAP) }],
  }));

  // 点击"果冻感": 按下整颗 tab 胶囊轻轻一缩, 松手用低阻尼弹簧回弹 (过冲抖动 = 果冻). 缩放挂在
  //   岛框 (Hosts 之外), 故动画稳、不受 SwiftUI 宿主裁剪; 触发来自各 tab 的 onPressIn/Out 回调.
  const capsuleScale = useSharedValue(1);
  const capsuleStyle = useAnimatedStyle(() => ({ transform: [{ scale: capsuleScale.value }] }));
  const onCapsulePressIn = useCallback(() => {
    capsuleScale.value = withTiming(0.93, { duration: 100, easing: Easing.out(Easing.quad) });
  }, [capsuleScale]);
  const onCapsulePressOut = useCallback(() => {
    capsuleScale.value = withSpring(1, { damping: 9, stiffness: 260, mass: 0.5 });
  }, [capsuleScale]);

  // ── 各 tab 长按菜单 (iOS 原生 ContextMenu; iOS 26 自动液态玻璃) 的动作回调 ──────────
  //   这些回调握有 navigation / queryClient / router / auth 上下文, 注入 TabContextMenu;
  //   @expo/ui 本身只在 TabContextMenu.ios 里碰 (见该文件), 本组件不直接依赖它.
  const queryClient = useQueryClient();
  const clearAuth = useAuth((s) => s.clear);

  // 跳到「财知」某子页: 先切到 caizhi tab, 再经 store 把子页请求递给 CaizhiScreen.
  const jumpCaizhi = useCallback(
    (page: number) => {
      navigation.navigate("caizhi");
      useCaizhiNav.getState().requestPage(page);
    },
    [navigation],
  );

  // 退出登录: 与「我」页同款二次确认; server 出错不阻塞本地清理 (token 反正不再用).
  const confirmLogout = useCallback(() => {
    Alert.alert("退出登录", "确认退出当前账号?", [
      { text: "再想想", style: "cancel" },
      {
        text: "退出",
        style: "destructive",
        onPress: async () => {
          try {
            await logout();
          } catch {
            // 本地清理不被 server 错误阻塞
          }
          await clearAuth();
          router.replace("/login");
        },
      },
    ]);
  }, [clearAuth]);

  const tabMenuActions = useMemo<TabMenuActions>(
    () => ({
      jumpCaizhi,
      refreshAttention: () => {
        void queryClient.invalidateQueries({ queryKey: ["attention"] });
      },
      editProfile: () => router.push("/profile/edit"),
      changePassword: () => router.push("/profile/password"),
      openNotifications: () => router.push("/notifications"),
      logout: confirmLogout,
    }),
    [jumpCaizhi, queryClient, confirmLogout],
  );

  return (
    // host 满宽、绝对定位、不吃触摸 (box-none) —— 让胶囊两侧/下方的内容仍可点.
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + theme.spacing.sm }]}
    >
      <View pointerEvents="box-none" style={styles.row}>
        {/* 左: 独立分类格 (与右侧 tab 岛分离, 中间留缝). */}
        <BottomCategoryCell isDark={isDark} />

        {/* 右: tab 岛 —— 三层叠放 (岛框只定尺寸/锚点, 不缩放):
            1) 玻璃胶囊层 (描边 + 玻璃 + 透镜): **单独**做果冻缩放. 图标不在这层, 故缩放重采样
               不会波及图标 —— 解决"按钮图标短暂发虚" (缩放任何含图标的栅格层都会重采样致糊).
            2) tab 内容层 (图标/标签): 独立、**不缩放** → 始终清晰; 透明背景, 让其下玻璃透出.
            每个 tab 再各裹一层原生 ContextMenu —— 长按弹液态玻璃快捷菜单 (见 ./TabContextMenu). */}
        <View style={[styles.islandFrame, { width: islandWidth }]}>
          <Animated.View
            pointerEvents="none"
            style={[styles.capsuleVisual, { borderColor: overlay.border }, capsuleStyle]}
          >
            <TabBarGlass
              isDark={isDark}
              capsuleRadius={PILL_RADIUS}
              lens={{
                left: LENS_LEFT,
                top: LENS_TOP,
                width: LENS_W,
                height: LENS_H,
                radius: theme.radius.lg,
              }}
              lensAnimatedStyle={highlightStyle}
              lensTint={overlay.lensGlassTint}
              lensFallback={overlay.activeFill}
              lensBorderColor={overlay.lensBorder}
              spacing={LENS_BLEND_SPACING}
            />
          </Animated.View>
          <View style={styles.tabsRow}>
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

              // 短按照常切 tab; 长按 → 原生玻璃菜单 (iOS). 长按由 ContextMenu 接管,
              //   故 TabButton 不再挂 onLongPress (避免与系统长按手势打架).
              return (
                <TabContextMenu
                  key={route.key}
                  routeName={route.name}
                  actions={tabMenuActions}
                  icon={meta.icon}
                >
                  <TabButton
                    meta={meta}
                    focused={focused}
                    onPress={onPress}
                    onPressIn={onCapsulePressIn}
                    onPressOut={onCapsulePressOut}
                  />
                </TabContextMenu>
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
  // 岛框: 只钉尺寸 (宽由 islandWidth 内联) + 给"玻璃胶囊层 / 图标层"当定位锚, 自身不画不裁.
  //   不裁 (无 overflow:hidden) 是有意的 —— 让玻璃胶囊回弹过冲时能略"鼓"出框外, 不被切平.
  islandFrame: {
    height: PILL_HEIGHT,
  },
  // 玻璃胶囊视觉层: 描边 + 圆角 + 把玻璃裁成药丸; 整层做果冻缩放 (图标层不在内, 故缩放不牵连图标).
  capsuleVisual: {
    ...StyleSheet.absoluteFillObject,
    borderRadius: PILL_RADIUS, // 半高 = 左右两侧完全圆形
    borderWidth: StyleSheet.hairlineWidth, // GlassView 不画 border, 故描边落在这层 (色内联随明暗)
    overflow: "hidden", // 裁掉玻璃圆角外的极小溢出 (含容器融合时的外溢)
  },
  // tab 内容层: 铺满岛框、居中等宽排布; 透明背景, 让其下玻璃/透镜透出. 居中后两侧自然留出
  //   ISLAND_PAD (岛宽 = 内容宽 + 2×PAD), 与透镜静态落点 LENS_LEFT 对齐.
  tabsRow: {
    ...StyleSheet.absoluteFillObject,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: TAB_GAP,
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
