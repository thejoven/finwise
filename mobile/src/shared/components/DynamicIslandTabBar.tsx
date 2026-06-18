import { useCallback, useEffect, useMemo, useRef } from "react";
import { Alert, Pressable, StyleSheet, Text, View, useColorScheme } from "react-native";
import { SymbolView, type SFSymbol } from "expo-symbols";
import Animated, {
  Easing,
  FadeIn,
  FadeOut,
  LinearTransition,
  ZoomIn,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
// 本 App 刻意用自定义液态玻璃底栏 (本组件经 bottom-tabs 的 tabBar 注入), 而非原生 native-tabs
// —— 这是"灵动岛"产品设计 (融合玻璃 + 滑动透镜), 原生 tab 栏给不了. 故 rn-no-non-native-navigator 在此为有意为之.
// react-doctor-disable-next-line react-doctor/rn-no-non-native-navigator
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { haptic } from "@/core/haptics";
import { theme, resolveColors } from "@/core/theme";
import { logout } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { BottomCategoryCell } from "@/features/project";
import { useCaizhiNav } from "@/features/caizhi/store";
// 具体路径 (不走 features/subscriptions barrel): barrel → SubscriptionsScreen →
// @/shared/components barrel → 本文件, 会成 require cycle. hooks.ts 只依赖 core, 无回边.
import { useUnreadTweetCount } from "@/features/subscriptions/hooks";

import { TabBarGlass, PILL_HEIGHT, PILL_RADIUS, TAB_BAR_OFFSET } from "./glass";
import { glassOverlay } from "./glass-overlay";
import { TabContextMenu, type TabMenuActions } from "./TabContextMenu";

/**
 * 底部栏 — 两颗分离的玻璃胶囊 (液态玻璃).
 *
 * 形态: 一行里并排两颗悬浮玻璃药丸, 中间留缝、互不相连:
 *   · 左「分类格」(BottomCategoryCell): 当前分类 + ▴, 点击向上弹分类下拉框.
 *   · 右「tab 岛」: 四个 tab (订阅 · 财知 · 标的 · 我) —— **上图标下文字**, 标签常驻可见.
 *   整行水平居中悬浮, 脱离屏幕边缘.
 *
 * 分类格只在「财知」tab 显示 (见 GOAL 本轮调整): 分类筛选只作用于财知内的信箱/降噪/归档/统计
 *   四张子页, 故离开财知时它淡出、岛体平滑归位居中; 回到财知再淡入. 切换走 reanimated
 *   layout 过渡 (BAR_REFLOW), 不"啪"地跳.
 *
 * 切换特效 (三段叠加, 利落不喧闹):
 *   1) 一颗"透镜"高亮 (highlight) 用弹簧滑到选中格底下 —— tab 等宽 (TAB_WIDTH) 故位置可
 *      直接算: translateX = index × SLOT, 无需 onLayout 量.
 *   2) 滑行瞬间透镜横向"液态拉伸" (跳得越远拉得越长, 纵向等比压扁守住体积感), 到站弹簧
 *      回圆 —— 像一滴被甩过去的水珠 (见 STRETCH_*).
 *   3) 选中那一刻图标轻轻一"弹" (scale 1→1.14→1), 由 TabButton 各自持有的 sharedValue 驱动;
 *      重按已选中 tab 也弹 —— 告诉手指"我收到了".
 *
 * 横扫换台 (scrub): 在 tab 岛上水平拖动可"拎着"透镜扫过各格 (微微抬起 GRAB_SCALE), 每跨一格
 *   一声 selection 咔哒, 松手按落点 + 甩动速度就近吸附并切过去. 手势横移 10px 起判, 不抢
 *   短按 (Pressable) 与长按 (ContextMenu); 竖向先动 14px 则让位 (failOffsetY).
 *
 * 入场: 冷启 / 登录后整行胶囊从下方 18px 弹簧浮上来"落座" (只动 translateY 不动 opacity ——
 *   给 UIVisualEffectView 的父层动 alpha 会闪).
 *
 * 材质: iOS 26+ 走 GlassView (liquid glass), 以下 / Android 降级 BlurView —— 收在
 *   `./glass` 的 `IslandGlass`, 两颗胶囊共用, 长成一对. 图标/标签直接用 theme.color
 *   的动态色 (随明暗自动翻); 描边/高亮这类非调色板 rgba 走 `glassOverlay`.
 *
 * 为什么走自定义 `tabBar`: 悬浮胶囊要自控位置/形状/动画, 且要在 tab 左侧塞一颗独立分类格,
 *   默认 bar 给不了. 自定义 tabBar 下, screenOptions 的 tabBarStyle / tint 等全部失效.
 *
 * 高度账: host bottom = insets.bottom + TAB_BAR_OFFSET(8); 胶囊高 = PILL_HEIGHT(56). 故岛顶
 *   距屏底 = insets.bottom + 64; 各 tab 屏 paddingBottom 统一走 TAB_BAR_CLEARANCE(80, 见
 *   ./glass) —— 滚到底时末行与岛顶仍隔 16, 改岛高只动 glass 里的常量.
 *
 * 触感: 切 tab / 横扫跨格都走 selection 触感 (haptic.selection), 见 references/06-haptic-grammar.md.
 *
 * 长按: 每个 tab 各裹一层原生 ContextMenu (iOS 26 液态玻璃快捷菜单) —— 财知跳子页 (信箱/降噪/
 *   归档/统计)、我→编辑/密码/通知/退出. 收在 `./TabContextMenu`(.ios), @expo/ui 只在那个 .ios 文件里碰.
 *
 * @see ./glass
 * @see ./TabContextMenu
 * @see BottomCategoryCell
 * @see https://reactnavigation.org/docs/bottom-tab-navigator/#tabbar
 */

// ── tab 岛几何 (等宽栅格, 让滑动高亮可直接算出落点) ────────────────────
//   52×48: 超过 HIG 最小触控目标 44pt、接近系统 tab item 的宽度档 —— 改这两个值时
//   同步 TabContextMenu.ios 的 TAB_W/TAB_H (那边钉死 Host 尺寸, 不跨文件引以免环引用).
const TAB_WIDTH = 52;
const TAB_HEIGHT = 48;
const TAB_GAP = theme.spacing.xs; // 4 —— 格与格之间
const ISLAND_PAD = theme.spacing.xs; // 4 —— 岛内左右留白 (+LENS_INSET 2 = 透镜四周统一内缩 6)
/** 相邻两格的中心间距 —— 透镜位移 / 横扫换算都按它. */
const SLOT = TAB_WIDTH + TAB_GAP;
/** 高亮滑动的弹簧手感 —— 利落但不生硬. */
const SLIDE = { damping: 18, stiffness: 220, mass: 0.7 };
/** 透镜"液态拉伸": 切换瞬间横向拉长 BASE + PER_SLOT × 跳跃格数 (封顶 MAX), 到站弹簧回圆. */
const STRETCH_BASE = 0.05;
const STRETCH_PER_SLOT = 0.06;
const STRETCH_MAX = 0.2;
/** 横扫 (scrub) 时透镜微微抬起的比例 —— 像被手指拎着的镜片. */
const GRAB_SCALE = 1.07;
/** 松手时甩动速度折算成落点偏置: velocityX(px/s) ÷ 此值 → index 偏移 (900px/s ≈ 半格). */
const FLING_DIVISOR = 1800;
/** 选中"透镜"相对格子内缩一圈 —— 留出呼吸, 看着像悬浮的玻璃镜片而非铺满的方块. */
const LENS_INSET = 2;
// 透镜几何 (相对岛框): 玻璃层是 absoluteFill, 故把 ISLAND_PAD/居中偏移直接折进静态落点;
//   滑动只剩纯 translateX = index × SLOT.
const LENS_W = TAB_WIDTH - LENS_INSET * 2;
const LENS_H = TAB_HEIGHT - LENS_INSET * 2;
const LENS_LEFT = ISLAND_PAD + LENS_INSET; // 对齐第 0 格的透镜左缘
const LENS_TOP = (PILL_HEIGHT - TAB_HEIGHT) / 2 + LENS_INSET; // tab 在胶囊内垂直居中 + 内缩
/** 同心圆角 (iOS 嵌套圆角规范): 内层圆角 = 外层圆角 − 内缩距离, 内外弧线同圆心不打架.
 *  现值 28 − 6 = 22 = LENS_H 半高 —— 透镜恰好也是一颗完整小胶囊. */
const LENS_RADIUS = PILL_RADIUS - LENS_TOP;
/** GlassContainer 融合距离: 透镜与胶囊在此距离内开始原生粘连/形变. 偏大=更易"相吸", 需上机调. */
const LENS_BLEND_SPACING = 18;

/** 分类格进出财知时整行的"重排"过渡 —— 分类格淡入/淡出, tab 岛平滑滑到新的居中位置,
 *  不"啪"地跳. 走 App 统一的丝滑无回弹手感 (同 shared/motion 的 LIST_LAYOUT). */
const BAR_REFLOW = LinearTransition.springify().damping(28).stiffness(300);
/** 分类格的淡入/淡出时长 —— 比重排略短, 让它先到位/先隐去, 视觉利落. */
const CELL_FADE_MS = 160;

/** worklet 版 clamp —— 横扫手势在 UI 线程算透镜落点用. */
function clampWorklet(v: number, lo: number, hi: number) {
  "worklet";
  return Math.max(lo, Math.min(hi, v));
}

/** route name → 图标. 顺序/键名必须与 `(tabs)/_layout.tsx` 的 <Tabs.Screen> 一致.
 *  标签不在此 (随语言切换, 故在组件内经 `t("nav.tabs.<route>")` 取, 见 tabLabel). */
type TabMeta = { icon: SFSymbol; iconSelected: SFSymbol };
const TAB_META: Record<string, TabMeta> = {
  subscriptions: { icon: "newspaper", iconSelected: "newspaper.fill" },
  caizhi: { icon: "books.vertical", iconSelected: "books.vertical.fill" },
  // 标的: 价格走势曲线 —— 此页内核就是"发现后股价怎么走". 该 symbol 无 .fill 变体, 选中靠 ink
  //   tint + 玻璃透镜滑入, 故 icon/iconSelected 同名 (避免猜 .fill 渲染成空).
  track: { icon: "chart.line.uptrend.xyaxis", iconSelected: "chart.line.uptrend.xyaxis" },
  profile: { icon: "person", iconSelected: "person.fill" },
};

/** 单个 tab —— 上图标下文字. 选中时图标轻弹一下 (各自持 sharedValue, 故抽成组件挂 hook);
 *  重按已选中 tab 也弹 (focused 不变、effect 不跑, 得在 onPress 里补) —— 确认"我收到了".
 *  dot: 未读小红点 (纯点不带数字 — 数字是焦虑制造机, 具体数额放订阅刊头 stamp, UX §8.1);
 *  出现时弹簧弹入 / 消失时淡出 —— 静默闪现反而像渲染故障. */
function TabButton({
  meta,
  label,
  focused,
  dot,
  dotColor,
  onPress,
  onPressIn,
  onPressOut,
}: {
  meta: TabMeta;
  /** 当前语言下的 tab 名 (随语言切换, 由父级经 `t()` 传入). */
  label: string;
  focused: boolean;
  dot?: boolean;
  /** 红点颜色 —— 必须传**已解析的 hex** (非 theme.color 动态色): 红点带布局动画,
   *  Reanimated 在自己这侧解析颜色做插值, 不认 DynamicColorIOS 对象 (会抛 Invalid color). */
  dotColor: string;
  onPress: () => void;
  onPressIn: () => void;
  onPressOut: () => void;
}) {
  const pop = useSharedValue(1);
  const playPop = useCallback(() => {
    pop.value = withSequence(
      withTiming(1.14, { duration: 130, easing: Easing.out(Easing.cubic) }),
      withSpring(1, { damping: 10, stiffness: 180 }),
    );
  }, [pop]);
  // focused 来自导航状态 (非本组件的本地事件): 程序化跳转 / 深链也会改它 —— "聚焦即弹一下"
  // 跟 focused 跑 effect 才对, 而非塞进某个 onPress. no-event-handler 在此为误报.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    if (focused) playPop();
  }, [focused, playPop]);
  const iconStyle = useAnimatedStyle(() => ({ transform: [{ scale: pop.value }] }));

  // 重按已选中 tab: focused 不变、上面的 effect 不跑 —— 图标也得回应一下.
  const handlePress = () => {
    if (focused) playPop();
    onPress();
  };

  return (
    <Pressable
      onPress={handlePress}
      onPressIn={onPressIn}
      onPressOut={onPressOut}
      accessibilityRole="button"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.tab, pressed && styles.tabPressed]}
    >
      <Animated.View style={iconStyle}>
        <SymbolView
          name={focused ? meta.iconSelected : meta.icon}
          size={22}
          tintColor={focused ? theme.color.ink : theme.color.muted}
          resizeMode="scaleAspectFit"
        />
        {dot ? (
          <Animated.View
            entering={ZoomIn.springify().damping(12).stiffness(260)}
            exiting={FadeOut.duration(150)}
            style={[styles.dot, { backgroundColor: dotColor }]}
          />
        ) : null}
      </Animated.View>
      <Text
        numberOfLines={1}
        allowFontScaling={false}
        style={[styles.label, { color: focused ? theme.color.ink : theme.color.muted }]}
      >
        {label}
      </Text>
    </Pressable>
  );
}

export function DynamicIslandTabBar({ state, navigation }: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const scheme = useColorScheme();
  const isDark = scheme === "dark";
  // 红点要喂已解析的 hex (带布局动画, 见 TabButton.dotColor). 本组件已订阅 useColorScheme,
  //   故 resolveColors(scheme) 随明暗自动重算, 无需再走 useThemeColors 二次订阅.
  const palette = resolveColors(scheme);
  const overlay = glassOverlay(isDark);

  // 岛宽按等宽栅格算死 (tab 等宽, 故无需 onLayout 量): N 格 + 缝 + 左右留白.
  const tabCount = state.routes.reduce((n, r) => (TAB_META[r.name] ? n + 1 : n), 0);
  const islandWidth = tabCount * TAB_WIDTH + (tabCount - 1) * TAB_GAP + ISLAND_PAD * 2;

  // 分类格只在「财知」显示 (分类筛选只作用于财知内的信箱/降噪/归档/统计四张子页, 见组件头).
  //   离开财知 → 它淡出, tab 岛经 BAR_REFLOW 平滑滑回正中; 回财知 → 反之.
  const showCategoryCell = state.routes[state.index]?.name === "caizhi";

  // 入场: 整行胶囊从下方浮上来"落座" (弹簧轻微过冲 = 落下的分量感). 只动 translateY 不动
  //   opacity —— 给 UIVisualEffectView (玻璃) 的父层动 alpha 会闪 / 出系统警告.
  const enter = useSharedValue(0);
  useEffect(() => {
    enter.value = withDelay(60, withSpring(1, { damping: 15, stiffness: 150, mass: 0.8 }));
  }, [enter]);
  const enterStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - enter.value) * 18 }],
  }));

  // 高亮落点: 切 tab 时弹簧滑到新格 (初值即当前格, 故首帧不会从 0 滑过来). 静态偏移已折进
  //   LENS_LEFT/LENS_TOP, 位移只剩 index × SLOT. 透镜另有两个"液态"修饰:
  //   stretch = 切换瞬间按跳跃距离横向拉长再弹回 (纵向等比压扁 —— 体积守恒才像液体不像贴图);
  //   grab    = 横扫 (scrub) 时整颗透镜微微抬起, 像被手指拎着.
  const activeX = useSharedValue(state.index);
  const stretch = useSharedValue(1);
  const grab = useSharedValue(1);
  // 横扫松手时 onEnd 已把透镜弹簧送往落点, 随后 navigate 又触发本 effect —— 用这面小旗跳过
  //   那次重复动画 (否则透镜到站后再抖一下).
  const scrubCommitRef = useRef(false);
  const prevIndexRef = useRef(state.index);
  // state.index 来自导航状态 (非本组件的本地事件): 程序化跳转 / 深链 / 长按菜单跳子页都会改它
  // —— 透镜"跟着导航状态走"才对, 塞进某个 onPress 会漏掉这些路径. no-event-handler 在此为误报.
  useEffect(() => {
    // react-doctor-disable-next-line react-doctor/no-event-handler
    const dist = Math.abs(state.index - prevIndexRef.current);
    prevIndexRef.current = state.index;
    if (scrubCommitRef.current) {
      scrubCommitRef.current = false;
      return;
    }
    activeX.value = withSpring(state.index, SLIDE);
    if (dist > 0) {
      const peak = 1 + Math.min(STRETCH_BASE + STRETCH_PER_SLOT * dist, STRETCH_MAX);
      stretch.value = withSequence(
        withTiming(peak, { duration: 110, easing: Easing.out(Easing.quad) }),
        withSpring(1, { damping: 13, stiffness: 240, mass: 0.6 }),
      );
    }
  }, [state.index, activeX, stretch]);
  const highlightStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: activeX.value * SLOT },
      { scaleX: stretch.value * grab.value },
      { scaleY: (1 - (stretch.value - 1) * 0.55) * grab.value },
    ],
  }));

  // ── 横扫换台 (scrub): 在岛上水平拖动, 透镜跟手扫过各格, 松手就近吸附并切 tab ──────────
  //   横移 10px 起判 (activeOffsetX): 不抢 Pressable 短按与 ContextMenu 长按 (二者无横移);
  //   竖向先动 14px 则整个手势让位 (failOffsetY). 跨格触感与点按切 tab 同款 selection.
  const maxIndex = tabCount - 1;
  const dragBase = useSharedValue(0);
  const lastSnap = useSharedValue(state.index);
  const scrubTick = useCallback(() => {
    void haptic.selection();
  }, []);
  const commitScrub = useCallback(
    (target: number) => {
      const route = state.routes[target];
      if (route && state.index !== target) {
        scrubCommitRef.current = true;
        navigation.navigate(route.name);
      }
    },
    [navigation, state.index, state.routes],
  );
  const stateIndex = state.index; // worklet 闭包只捎原始值, 不拖整个 state 对象进 UI 线程
  const scrub = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX([-10, 10])
        .failOffsetY([-14, 14])
        .onStart(() => {
          dragBase.value = activeX.value;
          lastSnap.value = Math.round(activeX.value);
          grab.value = withTiming(GRAB_SCALE, { duration: 120, easing: Easing.out(Easing.quad) });
        })
        .onUpdate((e) => {
          const pos = clampWorklet(dragBase.value + e.translationX / SLOT, 0, maxIndex);
          activeX.value = pos;
          const snapped = Math.round(pos);
          if (snapped !== lastSnap.value) {
            lastSnap.value = snapped;
            runOnJS(scrubTick)();
          }
        })
        .onEnd((e) => {
          const pos = clampWorklet(dragBase.value + e.translationX / SLOT, 0, maxIndex);
          const target = clampWorklet(Math.round(pos + e.velocityX / FLING_DIVISOR), 0, maxIndex);
          activeX.value = withSpring(target, SLIDE);
          runOnJS(commitScrub)(target);
        })
        .onFinalize((_e, success) => {
          grab.value = withSpring(1, { damping: 14, stiffness: 260, mass: 0.6 });
          if (!success) {
            // 手势被系统取消 (没走到 onEnd): 透镜归位到当前 tab, 不悬在半路.
            activeX.value = withSpring(stateIndex, SLIDE);
          }
        }),
    [activeX, commitScrub, dragBase, grab, lastSnap, maxIndex, scrubTick, stateIndex],
  );

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
  //   这些回调握有 navigation / router / auth 上下文, 注入 TabContextMenu;
  //   @expo/ui 本身只在 TabContextMenu.ios 里碰 (见该文件), 本组件不直接依赖它.
  const clearAuth = useAuth((s) => s.clear);

  // 订阅未读红点 (60s 慢轮询; 未登录/离线静默失败 → 不显点).
  const subsUnread = useUnreadTweetCount().data ?? 0;

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
    Alert.alert(t("profile.logout.action"), t("profile.logout.confirm"), [
      { text: t("profile.logout.cancel"), style: "cancel" },
      {
        text: t("profile.logout.confirmAction"),
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
  }, [clearAuth, t]);

  const tabMenuActions = useMemo<TabMenuActions>(
    () => ({
      jumpCaizhi,
      editProfile: () => router.push("/profile/edit"),
      changePassword: () => router.push("/profile/password"),
      openNotifications: () => router.push("/notifications"),
      logout: confirmLogout,
    }),
    [jumpCaizhi, confirmLogout],
  );

  return (
    // host 满宽、绝对定位、不吃触摸 (box-none) —— 让胶囊两侧/下方的内容仍可点.
    <View
      pointerEvents="box-none"
      style={[styles.host, { bottom: insets.bottom + TAB_BAR_OFFSET }]}
    >
      <Animated.View pointerEvents="box-none" style={[styles.row, enterStyle]}>
        {/* 左: 独立分类格 (与右侧 tab 岛分离, 中间留缝) —— 仅财知显示, 进出走淡入/淡出.
            它增删时, 右侧 tab 岛经自身的 layout=BAR_REFLOW 平滑滑到新居中位 (透明的 row 上做
            layout 不可见, 故 layout 必须挂在"看得见"的岛框上, 而非这层 row). */}
        {showCategoryCell ? (
          <Animated.View
            pointerEvents="box-none"
            entering={FadeIn.duration(CELL_FADE_MS)}
            exiting={FadeOut.duration(CELL_FADE_MS)}
          >
            <BottomCategoryCell isDark={isDark} />
          </Animated.View>
        ) : null}

        {/* 右: tab 岛 —— 三层叠放 (岛框只定尺寸/锚点, 不缩放):
            1) 玻璃胶囊层 (描边 + 玻璃 + 透镜): **单独**做果冻缩放. 图标不在这层, 故缩放重采样
               不会波及图标 —— 解决"按钮图标短暂发虚" (缩放任何含图标的栅格层都会重采样致糊).
            2) tab 内容层 (图标/标签): 独立、**不缩放** → 始终清晰; 透明背景, 让其下玻璃透出.
               外面罩一层 Pan 手势 (GestureDetector) —— 横扫换台 (scrub), 见上.
            每个 tab 再各裹一层原生 ContextMenu —— 长按弹液态玻璃快捷菜单 (见 ./TabContextMenu).
            layout=BAR_REFLOW: 分类格淡入/淡出后, 岛框平滑滑到新的居中落点, 不"啪"地跳. */}
        <Animated.View style={[styles.islandFrame, { width: islandWidth }]} layout={BAR_REFLOW}>
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
                radius: LENS_RADIUS,
              }}
              lensAnimatedStyle={highlightStyle}
              lensTint={overlay.lensGlassTint}
              lensFallback={overlay.activeFill}
              lensBorderColor={overlay.lensBorder}
              spacing={LENS_BLEND_SPACING}
            />
          </Animated.View>
          <GestureDetector gesture={scrub}>
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
                      label={t(`nav.tabs.${route.name}` as "nav.tabs.caizhi")}
                      focused={focused}
                      dot={route.name === "subscriptions" && subsUnread > 0}
                      dotColor={palette.red}
                      onPress={onPress}
                      onPressIn={onCapsulePressIn}
                      onPressOut={onCapsulePressOut}
                    />
                  </TabContextMenu>
                );
              })}
            </View>
          </GestureDetector>
        </Animated.View>
      </Animated.View>
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
    gap: theme.spacing.xs, // 4 —— 图标与文字之间, 给标签一档呼吸
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
  // 订阅未读点 — 挂在图标右上角. 纯点无数字 (克制); 6pt 是系统 badge dot 的常规档 (5 在
  //   22pt 图标旁存在感不足). backgroundColor **不**写这里: 红点带布局动画, 须吃已解析的
  //   hex (见 TabButton 的 dotColor), 动态色对象会让 Reanimated 抛 Invalid color.
  dot: {
    position: "absolute",
    top: -2,
    right: -6,
    width: 6,
    height: 6,
    borderRadius: 999,
  },
});
