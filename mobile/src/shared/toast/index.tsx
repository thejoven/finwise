/**
 * Toast 系统 — 报刊风, 自研顶部浮层 (reanimated + gesture-handler + safe-area).
 *
 * 为什么不用第三方 toast 库: react-native-toast-message 在 banned 名单
 *   (docs/技术文档/native_feel_skill/references/05-wiseflow-restraint.md §9 ·
 *    docs/GOAL/AGENT_BRIEF.md §2.4). 这里改成纯 JS 方案: 一个极小的 zustand store 做
 *   命令式入口 (可在非 React 上下文调用), 一个挂在 app 根的 <ToastRoot/> 渲染动画浮层.
 *   不引入任何原生模块 —— EAS / New Arch 下无需额外 link.
 *
 * 用法 (API 与旧版完全一致):
 *   import { showToast } from "@/shared/toast";
 *   showToast({ stamp: "AI 推演", title: "你的信号 HBM ...", subtitle: "点开查看 ↗" });
 *   在 _layout 挂一次 <ToastRoot/>.
 *
 * 交互 (贴近原生): 弹簧从顶部下滑入场 · 到时自动收起 · 上滑或点击手动消除.
 * 视觉 (单一报刊样式): 左侧 ink 竖条 · paper2 背景 · Mono stamp · Display 标题 · Serif 副标.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { StyleSheet, View, type LayoutChangeEvent } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { create } from "zustand";

import { Display, Mono, Serif } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { useNotifications, type NotificationType } from "@/features/notifications";
import i18n from "@/core/i18n";

// ──────────────────── Public API ────────────────────

export interface ShowToastOpts {
  /** 顶部 Mono 小字, 例 "AI 推演" */
  stamp?: string;
  /** 主标题, Display 字体 */
  title: string;
  /** 可选副标 Serif italic */
  subtitle?: string;
  /** 默认 3500ms */
  durationMs?: number;
}

function showToast(opts: ShowToastOpts): void {
  useToastStore.getState().show(opts);
}

function hideToast(): void {
  useToastStore.getState().hide();
}

// ──────────────────── notify (toast + 持久化通知中心) ────────────────────

export interface NotifyOpts extends ShowToastOpts {
  /** 通知类型, 用于分类/筛选 */
  type: NotificationType;
  /** tap 通知后跳转的 expo-router 路径 (可选) */
  href?: string;
}

/**
 * notify — 一次性把通知投送到两个目的地:
 *   1. Toast 即时反馈 (3.5s 自动消失)
 *   2. 持久化通知中心 (用户在"我的 → 消息通知"里能看到历史)
 *
 * 用 getState() 调用方式: 因 Zustand getter, 在非 React 上下文调用也安全. fire-and-forget.
 */
export function notify(opts: NotifyOpts): void {
  showToast(opts);
  void useNotifications.getState().push({
    type: opts.type,
    stamp: opts.stamp ?? i18n.t("errors.toast.defaultStamp"),
    title: opts.title,
    subtitle: opts.subtitle,
    href: opts.href,
  });
}

// ──────────────────── 命令式入口 (zustand store) ────────────────────

interface ToastItem extends ShowToastOpts {
  /** 每次 show 自增, 让 <ToastRoot/> 的 effect 能区分"同一条复弹"与替换 */
  id: number;
}

interface ToastStore {
  current: ToastItem | null;
  show: (opts: ShowToastOpts) => void;
  hide: () => void;
}

let counter = 0;

/** 模块级 store: showToast/hideToast 走 getState(), <ToastRoot/> 走 hook 订阅. */
const useToastStore = create<ToastStore>((set) => ({
  current: null,
  show: (opts) => set({ current: { ...opts, id: ++counter } }),
  hide: () => set({ current: null }),
}));

// ──────────────────── Root 浮层 ────────────────────

const DEFAULT_MS = 3500;
const TOP_GAP = theme.spacing.sm;
/** 入场弹簧 —— 利落、轻微回弹. */
const SPRING = { damping: 18, stiffness: 200, mass: 0.8 } as const;
/** 上滑多少 px (或够快) 即判定为"划走". */
const DISMISS_DY = -20;
const DISMISS_VY = -600;

/** Root 组件: 在 app 入口挂一次. */
export function ToastRoot() {
  const insets = useSafeAreaInsets();
  // Reanimated 不认 DynamicColorIOS 动态色 → 卡片底色/描边取 resolved hex (同 SegmentedTabs).
  const c = useThemeColors();
  const current = useToastStore((s) => s.current);
  // shown 在退场动画期间继续承载内容 (current 已置空也先不卸载), 动画走完再清.
  const [shown, setShown] = useState<ToastItem | null>(null);

  const progress = useSharedValue(0); // 0 收起(屏外) → 1 展开
  const cardH = useSharedValue(140); // onLayout 量到真实高度前的兜底值
  const dragY = useSharedValue(0); // 手指上滑的临时位移

  const topPad = insets.top + TOP_GAP;

  useEffect(() => {
    if (current) {
      setShown(current);
      dragY.value = 0;
      progress.value = withSpring(1, SPRING);
      const timer = setTimeout(
        () => useToastStore.getState().hide(),
        current.durationMs ?? DEFAULT_MS,
      );
      return () => clearTimeout(timer);
    }
    // 收起: 滑回屏幕上方, 动画完再把 shown 清掉卸载.
    progress.value = withTiming(0, { duration: 220 }, (finished) => {
      if (finished) runOnJS(setShown)(null);
    });
    return undefined;
  }, [current, progress, dragY]);

  const cardStyle = useAnimatedStyle(() => {
    // 从完全在屏外 (上方 cardH + topPad) 滑到 0; 叠加手指上滑位移.
    const baseY = interpolate(
      progress.value,
      [0, 1],
      [-(cardH.value + topPad), 0],
      Extrapolation.CLAMP,
    );
    return {
      opacity: progress.value,
      transform: [{ translateY: baseY + dragY.value }],
    };
  }, [topPad]);

  const onLayout = useCallback(
    (e: LayoutChangeEvent) => {
      cardH.value = e.nativeEvent.layout.height;
    },
    [cardH],
  );

  const gesture = useMemo(() => {
    const dismiss = () => useToastStore.getState().hide();
    const pan = Gesture.Pan()
      .onUpdate((e) => {
        // 只跟随向上的拖动 (向下不放大, 免得越拉越长).
        dragY.value = Math.min(e.translationY, 0);
      })
      .onEnd((e) => {
        if (e.translationY < DISMISS_DY || e.velocityY < DISMISS_VY) {
          runOnJS(dismiss)();
        } else {
          dragY.value = withSpring(0, SPRING);
        }
      });
    const tap = Gesture.Tap().onEnd(() => runOnJS(dismiss)());
    return Gesture.Race(pan, tap);
  }, [dragY]);

  if (!shown) return null;

  return (
    <View pointerEvents="box-none" style={[styles.host, { paddingTop: topPad }]}>
      <GestureDetector gesture={gesture}>
        <Animated.View
          style={[styles.card, { backgroundColor: c.paper2, borderColor: c.rule }, cardStyle]}
          onLayout={onLayout}
        >
          <View style={styles.row}>
            <View style={styles.accent} />
            <View style={styles.body}>
              {shown.stamp ? (
                <Mono size={9} style={styles.stamp}>
                  {shown.stamp}
                </Mono>
              ) : null}
              <Display size={15} style={styles.title} numberOfLines={2}>
                {shown.title}
              </Display>
              {shown.subtitle ? (
                <Serif size={12} italic style={styles.subtitle} numberOfLines={2}>
                  {shown.subtitle}
                </Serif>
              ) : null}
            </View>
          </View>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  host: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center", // 居中那张 92% 宽的卡片
    zIndex: 100, // 盖在所有 screen 上面
  },
  card: {
    width: "92%",
    borderWidth: StyleSheet.hairlineWidth,
    // backgroundColor / borderColor 内联 resolved hex — Reanimated 不认动态色.
    // 跨平台投影: 新架构 boxShadow 同覆盖 iOS/Android, 取代旧 shadow*/elevation.
    boxShadow: "0px 2px 6px rgba(0,0,0,0.1)",
  },
  row: {
    flexDirection: "row",
    minHeight: 64,
  },
  accent: {
    width: 3,
    backgroundColor: theme.color.ink,
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: 2,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  title: {
    color: theme.color.ink,
    lineHeight: 22,
  },
  subtitle: {
    color: theme.color.muted,
    lineHeight: 18,
    marginTop: 2,
  },
});
