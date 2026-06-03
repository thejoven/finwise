/**
 * CluesDrawer — 从右侧滑出的"相关线索"抽屉.
 *
 * 触发: RefinementScreen 顶部右上角 pill 按钮 (CluesTrigger). 打开后:
 *   - 半透明遮罩淡入, 点击遮罩关闭
 *   - 抽屉从右侧滑入, 占屏 85% 宽 (左侧露 15% 遮罩)
 *   - 把抽屉向右拖拽可关闭: 跟手, 中途可打断, 松手按手指速度 spring 收尾
 *   - 内容: 顶部一行 "相关线索 · N 条" + LearningTimeline 时间线
 *
 * 实现: Reanimated 4 + gesture-handler Pan; worklet 控制 translateX + opacity.
 *   - 抽屉宽 = screen * 0.85
 *   - 关闭态 translateX = drawerWidth (移出右边屏外)
 *   - 打开态 translateX = 0
 *
 * 不阻塞主屏滚动 — Modal-style 用 absolute fill + zIndex; 配 SafeAreaView 让顶
 * 部 notch / 底部 home indicator 不挡内容.
 */

import { useEffect } from "react";
import { Dimensions, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector, ScrollView } from "react-native-gesture-handler";
import { SafeAreaView } from "react-native-safe-area-context";
import Animated, {
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
} from "react-native-reanimated";

import { Icon, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { SHEET_SPRING as SPRING } from "@/shared/motion";
import type { ResearchRecord } from "@/core/api/research";

import { LearningTimeline } from "./LearningCard";

interface Props {
  open: boolean;
  onClose: () => void;
  items?: ResearchRecord[];
  loading: boolean;
}

const DRAWER_RATIO = 0.85;

export function CluesDrawer({ open, onClose, items, loading }: Props) {
  const { width } = useWindowDimensions();
  const drawerWidth = width * DRAWER_RATIO;
  // Reanimated 的 Animated.View 不认 DynamicColorIOS 动态色 → 抽屉底色/边线取 resolved hex.
  const c = useThemeColors();

  // translateX shared value: drawerWidth(关) ↔ 0(开).
  const tx = useSharedValue(drawerWidth);
  // 手势起点 — onStart 记下当前 tx, 让拖拽能从动画半途接管 (可打断).
  const startX = useSharedValue(0);

  // prop 驱动的开/关: 用 spring 收尾, 比固定时长的 timing 更跟手.
  useEffect(() => {
    tx.value = withSpring(open ? 0 : drawerWidth, SPRING);
  }, [open, drawerWidth, tx]);

  // 向右拖拽关闭 — 内容跟着手指走, 松手按手指速度 spring 收尾.
  const pan = Gesture.Pan()
    .activeOffsetX([-15, 15]) // 只认横向拖拽, 纵向滚动留给内部 ScrollView
    .onStart(() => {
      startX.value = tx.value; // 从当前位置接管, 哪怕动画还没停
    })
    .onChange((e) => {
      // 只能往"关"的方向(右)拖; 往左封顶在完全打开的 0.
      tx.value = Math.max(0, startX.value + e.translationX);
    })
    .onEnd((e) => {
      // 拖过 40% 或向右快速一甩就关, 否则弹回打开.
      const shouldClose = tx.value > drawerWidth * 0.4 || e.velocityX > 800;
      if (shouldClose) {
        tx.value = withSpring(drawerWidth, { ...SPRING, velocity: e.velocityX }, (finished) => {
          if (finished) runOnJS(onClose)();
        });
      } else {
        tx.value = withSpring(0, { ...SPRING, velocity: e.velocityX });
      }
    });

  const drawerStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: tx.value }],
  }));

  const scrimStyle = useAnimatedStyle(() => ({
    opacity: interpolate(tx.value, [0, drawerWidth], [0.45, 0]),
    // 完全关闭时不挡触摸 (pointerEvents 在 style 里只能动效化 opacity, 用 display 切)
    display: tx.value >= drawerWidth - 0.5 ? "none" : "flex",
  }));

  const totalResults = (items ?? []).reduce((acc, r) => acc + r.results.length, 0);

  return (
    <View pointerEvents={open ? "auto" : "none"} style={[StyleSheet.absoluteFill, styles.layer]}>
      {/* 半透明遮罩, 点击关闭. 用 Pressable 而非 TapEffect — 后者要求 children. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.scrim, scrimStyle]}>
        <Pressable style={StyleSheet.absoluteFillObject} onPress={onClose} />
      </Animated.View>

      {/* 抽屉本体 — 整块可向右拖拽关闭 */}
      <GestureDetector gesture={pan}>
        <Animated.View
          style={[
            styles.drawer,
            { width: drawerWidth, backgroundColor: c.paper, borderLeftColor: c.rule },
            drawerStyle,
          ]}
        >
          <SafeAreaView edges={["top", "bottom", "right"]} style={styles.drawerInner}>
            <View style={styles.headerRow}>
              <View style={styles.headerLeft}>
                <View style={styles.diamond} />
                <Sans size={10} weight="700" style={styles.headerLabel}>
                  相关线索
                </Sans>
                <Serif size={10} italic style={styles.headerMeta}>
                  {computeStatusMeta({ items, loading, totalResults })}
                </Serif>
              </View>
              <TapEffect style={styles.closeBtn} onPress={onClose} disableEffect>
                <Icon name="close" size={18} color={theme.color.ink} strokeWidth={1.5} />
              </TapEffect>
            </View>

            <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
              {totalResults > 0 ? (
                <LearningTimeline items={items} />
              ) : (
                <View style={styles.emptyWrap}>
                  <Mono size={9} style={styles.emptyStamp}>
                    STATUS · {loading ? "FETCHING" : "EMPTY"}
                  </Mono>
                  <Serif size={13} italic style={styles.emptyHint}>
                    {loading
                      ? "Mastra 还在拉外部资料, 一两秒…"
                      : "这条信号没找到匹配的外部新闻 — 推演会直接用你写下的原文."}
                  </Serif>
                </View>
              )}
            </ScrollView>
          </SafeAreaView>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

function computeStatusMeta({
  items,
  loading,
  totalResults,
}: {
  items?: ResearchRecord[];
  loading: boolean;
  totalResults: number;
}): string {
  if (totalResults > 0) return `· ${totalResults} 条来源`;
  if (!items && loading) return "· 加载中…";
  return "· 未检索到";
}

const SCREEN_HEIGHT = Dimensions.get("window").height;

const styles = StyleSheet.create({
  layer: {
    zIndex: 100,
  },
  scrim: {
    backgroundColor: "#000",
  },
  drawer: {
    position: "absolute",
    top: 0,
    bottom: 0,
    right: 0,
    height: SCREEN_HEIGHT,
    // backgroundColor / borderLeftColor 内联 resolved hex — Reanimated 不认动态色.
    borderLeftWidth: StyleSheet.hairlineWidth,
    // iOS 阴影
    shadowColor: "#000",
    shadowOffset: { width: -3, height: 0 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    // Android 阴影
    elevation: 12,
  },
  drawerInner: {
    flex: 1,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
    gap: theme.spacing.sm,
  },
  headerLeft: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
  },
  headerLabel: {
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.ink,
  },
  headerMeta: {
    color: theme.color.muted,
  },
  closeBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.xxl,
  },
  emptyWrap: {
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.lg,
  },
  emptyStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
  },
  emptyHint: {
    color: theme.color.muted,
    lineHeight: 22,
  },
});
