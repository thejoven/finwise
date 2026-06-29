/**
 * SwipeDeck — 订阅 tab 的卡片分拣台 (开发文档 §4).
 *
 * 一次一张, 三向手势:
 *   左滑 = 已读      (POST /tweets/:id/read, 复用)
 *   右滑 = 转信号    (POST /tweets/:id/promote, 复用, 空 note 原文直通)
 *   下滑 = 不感兴趣  (P0 仅前端隐藏; P1 接 /tweets/:id/not-interested)
 *   点击 = 进详情
 *
 * 手感: 顶卡跟手 (translate + rotate), 释放按距离**或**速度判定 (快甩不必拖满),
 *   命中即朝该方向飞出, 否则 spring 弹回. 飞出完成 → onCommit → 推进牌堆.
 *   每张顶卡按 tweet.id 作 key, 独占自己的 shared value, 飞出后随 key 变更卸载 —— 无残影.
 *
 * 撤销: 滑动只乐观推进 UI, 服务端动作经 useSwipeActions 延迟提交; 顶部 toast 内「撤销」
 *   在窗口内取消并把卡片弹回 (见 §3 硬四).
 *
 * Reanimated Animated.View 不认 DynamicColorIOS 动态色 → 角标的描边/文字色取
 *   useThemeColors() 的 resolved hex; SignalCard 是普通 View, 仍走 theme.color.
 */

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { StyleSheet, View, useWindowDimensions } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";
import Animated, {
  Extrapolation,
  interpolate,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import {
  Icon,
  Mono,
  Sans,
  Serif,
  TAB_BAR_CLEARANCE,
  TapEffect,
  type IconName,
} from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { SHEET_SPRING as SPRING } from "@/shared/motion";
import { haptic } from "@/core/haptics";
import type { TweetItem } from "@/core/api/subscriptions";

import { SignalCard } from "./SignalCard";
import { useSwipeActions, type PendingSwipe, type SwipeDir } from "./useSwipeActions";

type Palette = ReturnType<typeof useThemeColors>;

const SWIPE_X = 95;
const SWIPE_Y = 120;
const VEL = 800; // px/s — 与 CluesDrawer 的快甩阈值同口径
const FLING_MS = 240;

interface TopCardHandle {
  flick: (dir: SwipeDir) => void;
}

interface Props {
  tweets: TweetItem[];
  isLoading: boolean;
  hasNextPage: boolean;
  fetchNextPage: () => void;
  onRead: (id: string) => void;
  onPromote: (id: string) => void;
  onNotInterested?: (id: string) => void;
  onSaveLater?: (id: string) => void;
}

export function SwipeDeck({
  tweets,
  isLoading,
  hasNextPage,
  fetchNextPage,
  onRead,
  onPromote,
  onNotInterested,
  onSaveLater,
}: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const c = useThemeColors();

  const [consumed, setConsumed] = useState<string[]>([]);
  const consumedSet = useMemo(() => new Set(consumed), [consumed]);
  const visible = useMemo(
    () => tweets.filter((tw) => !consumedSet.has(tw.id)),
    [tweets, consumedSet],
  );
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  const topRef = useRef<TopCardHandle | null>(null);
  const { pending, run, undo } = useSwipeActions({
    onRead,
    onPromote,
    onNotInterested,
    onSaveLater,
  });

  // fetchNextPage prop 每帧都是新身份 (上层内联箭头) → 放 ref, 让预取 effect 只依赖
  // visible.length / hasNextPage; 否则 effect 每帧都跑, 是 "Maximum update depth" 的隐患.
  const fetchRef = useRef(fetchNextPage);
  fetchRef.current = fetchNextPage;

  // 可见不足时预取下一页, 让牌堆不断流.
  useEffect(() => {
    if (visible.length <= 2 && hasNextPage) fetchRef.current();
  }, [visible.length, hasNextPage]);

  const commit = useCallback(
    (dir: SwipeDir) => {
      const top = visibleRef.current[0];
      if (!top) return;
      void haptic.selection();
      setConsumed((prev) => (prev.includes(top.id) ? prev : [...prev, top.id]));
      run(top, dir);
    },
    [run],
  );

  const openTop = useCallback(() => {
    const top = visibleRef.current[0];
    if (top) router.push(`/tweet/${top.id}`);
  }, []);

  const handleUndo = useCallback(() => {
    const undone = undo();
    if (undone) setConsumed((prev) => prev.filter((id) => id !== undone.tweet.id));
  }, [undo]);

  const top = visible[0];
  const back1 = visible[1];
  const back2 = visible[2];
  const done = !top && !isLoading && !hasNextPage;

  return (
    <View style={styles.deck}>
      <View style={styles.stackArea}>
        {back2 ? <BackCard key={back2.id} tweet={back2} depth={2} /> : null}
        {back1 ? <BackCard key={back1.id} tweet={back1} depth={1} /> : null}
        {top ? (
          <TopCard
            key={top.id}
            ref={topRef}
            tweet={top}
            palette={c}
            onCommit={commit}
            onOpen={openTop}
          />
        ) : (
          <View style={styles.placeholder}>
            {done ? (
              <>
                <Mono size={12} style={styles.doneStamp}>
                  {t("subscriptions.empty.allRead.stamp")}
                </Mono>
                <Serif size={13} italic style={styles.doneText}>
                  {t("subscriptions.empty.allRead.body")}
                </Serif>
              </>
            ) : (
              <Serif size={13} italic style={styles.doneText}>
                {t("subscriptions.empty.loading")}
              </Serif>
            )}
          </View>
        )}
      </View>

      <View style={[styles.actions, { paddingBottom: insets.bottom + TAB_BAR_CLEARANCE }]}>
        <ActionButton
          label={t("subscriptions.swipe.actRead")}
          icon="check"
          tint={c.ink2}
          disabled={!top}
          onPress={() => topRef.current?.flick("left")}
        />
        <ActionButton
          label={t("subscriptions.swipe.actSave")}
          icon="book"
          tint={c.ink2}
          disabled={!top}
          onPress={() => topRef.current?.flick("up")}
        />
        <ActionButton
          label={t("subscriptions.swipe.actSkip")}
          icon="eyeOff"
          tint={c.red}
          disabled={!top}
          onPress={() => topRef.current?.flick("down")}
        />
        <ActionButton
          label={t("subscriptions.swipe.actSignal")}
          icon="arrowUpRight"
          tint={c.green}
          disabled={!top}
          onPress={() => topRef.current?.flick("right")}
        />
      </View>

      {/* 撤销 toast — 顶部居中, 简洁胶囊 (动作结果 + 撤销). */}
      {pending ? (
        <View style={styles.toastWrap} pointerEvents="box-none">
          <View style={[styles.toast, { backgroundColor: c.ink }]}>
            <Sans size={12} style={[styles.toastText, { color: c.paper }]} numberOfLines={1}>
              {toastMessage(pending, t)}
            </Sans>
            <View style={[styles.toastDivider, { backgroundColor: c.paper }]} />
            <TapEffect onPress={handleUndo} disableEffect>
              <Mono size={12} style={{ color: c.paper }}>
                {t("subscriptions.swipe.undo")}
              </Mono>
            </TapEffect>
          </View>
        </View>
      ) : null}
    </View>
  );
}

const TopCard = forwardRef<
  TopCardHandle,
  {
    tweet: TweetItem;
    palette: Palette;
    onCommit: (dir: SwipeDir) => void;
    onOpen: () => void;
  }
>(function TopCard({ tweet, palette, onCommit, onOpen }, ref) {
  const { width, height } = useWindowDimensions();
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const flingX = width * 1.5;
  const flingY = height;

  useImperativeHandle(
    ref,
    () => ({
      flick: (dir: SwipeDir) => {
        if (dir === "down" || dir === "up") {
          tx.value = withTiming(0, { duration: FLING_MS });
          ty.value = withTiming(
            dir === "down" ? flingY : -flingY,
            { duration: FLING_MS },
            (fin) => {
              if (fin) runOnJS(onCommit)(dir);
            },
          );
        } else {
          const target = dir === "right" ? flingX : -flingX;
          ty.value = withTiming(0, { duration: FLING_MS });
          tx.value = withTiming(target, { duration: FLING_MS }, (fin) => {
            if (fin) runOnJS(onCommit)(dir);
          });
        }
      },
    }),
    [flingX, flingY, onCommit, tx, ty],
  );

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .onChange((e) => {
        tx.value += e.changeX;
        ty.value += e.changeY;
      })
      .onEnd((e) => {
        const dx = tx.value;
        const dy = ty.value;
        const ax = Math.abs(dx);
        let dir: SwipeDir | null = null;
        if (dy < 0 && -dy > ax && (-dy > SWIPE_Y || e.velocityY < -VEL)) dir = "up";
        else if (dy > 0 && dy > ax && (dy > SWIPE_Y || e.velocityY > VEL)) dir = "down";
        else if (dx > 0 && ax >= dy && (dx > SWIPE_X || e.velocityX > VEL)) dir = "right";
        else if (dx < 0 && ax >= dy && (dx < -SWIPE_X || e.velocityX < -VEL)) dir = "left";

        if (dir === "down" || dir === "up") {
          ty.value = withTiming(
            dir === "down" ? flingY : -flingY,
            { duration: FLING_MS },
            (fin) => {
              if (fin) runOnJS(onCommit)(dir);
            },
          );
        } else if (dir) {
          const target = dir === "right" ? flingX : -flingX;
          tx.value = withTiming(target, { duration: FLING_MS }, (fin) => {
            if (fin) runOnJS(onCommit)(dir);
          });
        } else {
          tx.value = withSpring(0, SPRING);
          ty.value = withSpring(0, SPRING);
        }
      });
    const tap = Gesture.Tap()
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) runOnJS(onOpen)();
      });
    return Gesture.Exclusive(pan, tap);
  }, [flingX, flingY, onCommit, onOpen, tx, ty]);

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { rotate: `${interpolate(tx.value, [-width, width], [-14, 14], Extrapolation.CLAMP)}deg` },
    ],
  }));

  const signalStamp = useAnimatedStyle(() => {
    const horiz = Math.abs(tx.value) >= Math.abs(ty.value);
    return {
      opacity: horiz ? interpolate(tx.value, [0, SWIPE_X], [0, 1], Extrapolation.CLAMP) : 0,
    };
  });
  const readStamp = useAnimatedStyle(() => {
    const horiz = Math.abs(tx.value) >= Math.abs(ty.value);
    return {
      opacity: horiz ? interpolate(tx.value, [-SWIPE_X, 0], [1, 0], Extrapolation.CLAMP) : 0,
    };
  });
  const skipStamp = useAnimatedStyle(() => {
    const vert = ty.value > 0 && ty.value > Math.abs(tx.value);
    return { opacity: vert ? interpolate(ty.value, [0, SWIPE_Y], [0, 1], Extrapolation.CLAMP) : 0 };
  });
  const saveStamp = useAnimatedStyle(() => {
    const vert = ty.value < 0 && -ty.value > Math.abs(tx.value);
    return {
      opacity: vert ? interpolate(-ty.value, [0, SWIPE_Y], [0, 1], Extrapolation.CLAMP) : 0,
    };
  });

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View style={[styles.cardAbs, cardStyle]}>
        <SignalCard tweet={tweet} />

        <Animated.View
          pointerEvents="none"
          style={[styles.stamp, styles.stampSignal, { borderColor: palette.green }, signalStamp]}
        >
          <Sans size={18} weight="700" style={[styles.stampText, { color: palette.green }]}>
            信号
          </Sans>
        </Animated.View>

        <Animated.View
          pointerEvents="none"
          style={[styles.stamp, styles.stampRead, { borderColor: palette.ink2 }, readStamp]}
        >
          <Sans size={18} weight="700" style={[styles.stampText, { color: palette.ink2 }]}>
            已读
          </Sans>
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.stampSkipWrap, skipStamp]}>
          <View style={[styles.stamp, styles.stampSkipInner, { borderColor: palette.red }]}>
            <Sans size={18} weight="700" style={[styles.stampText, { color: palette.red }]}>
              不感兴趣
            </Sans>
          </View>
        </Animated.View>

        <Animated.View pointerEvents="none" style={[styles.stampSaveWrap, saveStamp]}>
          <View style={[styles.stamp, styles.stampSaveInner, { borderColor: palette.ink2 }]}>
            <Sans size={18} weight="700" style={[styles.stampText, { color: palette.ink2 }]}>
              稍后读
            </Sans>
          </View>
        </Animated.View>
      </Animated.View>
    </GestureDetector>
  );
});

function BackCard({ tweet, depth }: { tweet: TweetItem; depth: number }) {
  return (
    <View
      pointerEvents="none"
      style={[
        styles.cardAbs,
        { transform: [{ translateY: depth * 10 }, { scale: 1 - depth * 0.04 }] },
      ]}
    >
      <SignalCard tweet={tweet} />
    </View>
  );
}

function ActionButton({
  label,
  icon,
  tint,
  disabled,
  onPress,
}: {
  label: string;
  icon: IconName;
  tint: string;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <TapEffect
      onPress={onPress}
      disableEffect
      style={[styles.actBtn, disabled && styles.actDisabled]}
    >
      <View style={[styles.actCircle, { borderColor: tint }]}>
        <Icon name={icon} size={24} color={tint} strokeWidth={1.75} />
      </View>
      <Mono size={11} style={styles.actLabel}>
        {label}
      </Mono>
    </TapEffect>
  );
}

function toastMessage(p: PendingSwipe, t: TFunction): string {
  if (p.dir === "right") return t("subscriptions.promote.doneOk");
  if (p.dir === "left") return t("subscriptions.swipe.read");
  if (p.dir === "up") return t("subscriptions.swipe.saved");
  const tags = (p.tweet.tags ?? []).slice(0, 2).map((x) => `#${x}`);
  const base = t("subscriptions.swipe.notInterested");
  return tags.length ? `${base} · ${tags.join(" ")}` : base;
}

const styles = StyleSheet.create({
  deck: {
    flex: 1,
  },
  stackArea: {
    flex: 1,
    position: "relative",
  },
  cardAbs: {
    position: "absolute",
    top: 6,
    left: theme.spacing.lg,
    right: theme.spacing.lg,
    bottom: 6,
  },
  placeholder: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xxl,
    gap: theme.spacing.sm,
  },
  doneStamp: {
    color: theme.color.green,
    letterSpacing: 2,
  },
  doneText: {
    color: theme.color.muted,
    textAlign: "center",
    lineHeight: 21,
  },
  stamp: {
    position: "absolute",
    top: 26,
    borderWidth: 2.5,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  stampSignal: {
    left: 26,
    transform: [{ rotate: "-11deg" }],
  },
  stampRead: {
    right: 26,
    transform: [{ rotate: "11deg" }],
  },
  stampSkipWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 34,
    alignItems: "center",
  },
  stampSkipInner: {
    position: "relative",
    top: undefined,
  },
  stampSaveWrap: {
    position: "absolute",
    left: 0,
    right: 0,
    top: 26,
    alignItems: "center",
  },
  stampSaveInner: {
    position: "relative",
    top: undefined,
  },
  stampText: {
    letterSpacing: 2,
  },
  toastWrap: {
    position: "absolute",
    top: 8,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 50,
  },
  toast: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    maxWidth: "94%",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  toastText: {
    flexShrink: 1,
  },
  toastDivider: {
    width: StyleSheet.hairlineWidth,
    height: 12,
    opacity: 0.35,
  },
  actions: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 14,
    paddingTop: 14,
  },
  actBtn: {
    alignItems: "center",
    gap: 6,
  },
  actDisabled: {
    opacity: 0.35,
  },
  actCircle: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 1.5,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.paper,
  },
  actLabel: {
    color: theme.color.muted,
  },
});
