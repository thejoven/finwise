/**
 * RefinementSteps — 五轮追问顶部固定进度条.
 *
 * 视觉:
 *   ●——●——⊙——○——○
 *
 *   - done    实心 ink 圆点  (已答的轮)
 *   - current 空心 ink 环   (pending / 等下一题)
 *   - future  虚化 muted 点 (未到的轮)
 *
 *   每两个点之间有 1px 短分隔线; current 段及之前 = ink 色; 之后 = ruleSoft 色.
 *
 * 交互:
 *   - 点击 done 点 → 父组件 scrollTo 对应 round 卡顶
 *   - 点击 current → scrollTo pending 块
 *   - 点击 future → no-op (用 opacity 表暗示, 不出 toast)
 *
 * 设计哲学: 不抢主体焦点 — 进度条只占 header 下方一条窄带; 与 Display 字体大小
 * 对比明显. 报刊感由小字 Mono + dot + rule 维持.
 */

import { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  Easing,
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";

import { Mono, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  /** 0..5; 5 表示全部答完 (current 不存在) */
  roundsDone: number;
  /** 是否还有 pending 当前题 (true 时第 roundsDone+1 个点是 current) */
  hasPending: boolean;
  /** 整个 session 是否 completed (全部 dot done) */
  completed: boolean;
  /** 点击进度点回调; round 是 1..5 数字. future 点不会触发 */
  onTapStep: (round: number) => void;
}

type DotState = "done" | "current" | "future";

export function RefinementSteps({ roundsDone, hasPending, completed, onTapStep }: Props) {
  const states = computeStates({ roundsDone, hasPending, completed });

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {states.map((state, i) => {
          const round = i + 1;
          const isLast = i === states.length - 1;
          return (
            <View key={round} style={styles.cell}>
              <Step state={state} round={round} onTap={() => onTapStep(round)} />
              {!isLast ? <Rule state={state} /> : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

function computeStates({
  roundsDone,
  hasPending,
  completed,
}: {
  roundsDone: number;
  hasPending: boolean;
  completed: boolean;
}): DotState[] {
  return [1, 2, 3, 4, 5].map((round) => {
    if (completed) return "done";
    if (round <= roundsDone) return "done";
    if (round === roundsDone + 1 && hasPending) return "current";
    if (round === roundsDone + 1 && !hasPending) return "current"; // 等下一题也算 current 位
    return "future";
  });
}

function Step({ state, round, onTap }: { state: DotState; round: number; onTap: () => void }) {
  // future 点禁用点击, 用 disableEffect 不要 pressed 反馈
  const disabled = state === "future";
  return (
    <TapEffect
      onPress={disabled ? undefined : onTap}
      disabled={disabled}
      disableEffect={disabled}
      style={styles.tap}
    >
      <View style={styles.dotWrap}>
        {state === "done" ? <View style={styles.dotDone} /> : null}
        {state === "current" ? <CurrentDot /> : null}
        {state === "future" ? <View style={styles.dotFuture} /> : null}
      </View>
      <Mono
        size={8}
        style={[styles.label, state === "future" ? styles.labelFuture : styles.labelActive]}
      >
        R{round}
      </Mono>
    </TapEffect>
  );
}

/** Step 之间的小分隔线; 已到达 current 之前的线段更黑, 之后灰. */
function Rule({ state }: { state: DotState }) {
  const reached = state === "done" || state === "current";
  return <View style={[styles.rule, !reached && styles.ruleSoft]} />;
}

/** Current dot with subtle outer halo pulse — 让"该做的就是这个"更显眼一点. */
function CurrentDot() {
  const haloScale = useSharedValue(1);
  const haloOpacity = useSharedValue(0.35);
  useEffect(() => {
    haloScale.value = withRepeat(
      withSequence(
        withTiming(1.8, { duration: 1100, easing: Easing.out(Easing.cubic) }),
        withTiming(1, { duration: 0 }),
      ),
      -1,
      false,
    );
    haloOpacity.value = withRepeat(
      withSequence(
        withTiming(0, { duration: 1100, easing: Easing.out(Easing.cubic) }),
        withTiming(0.35, { duration: 0 }),
      ),
      -1,
      false,
    );
    return () => {
      cancelAnimation(haloScale);
      cancelAnimation(haloOpacity);
    };
  }, [haloScale, haloOpacity]);

  const haloStyle = useAnimatedStyle(() => ({
    transform: [{ scale: haloScale.value }],
    opacity: haloOpacity.value,
  }));

  return (
    <View style={styles.currentWrap}>
      <Animated.View style={[styles.dotHalo, haloStyle]} />
      <View style={styles.dotCurrent} />
    </View>
  );
}

const DOT = 10;

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
    backgroundColor: theme.color.paper,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cell: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    // 最后一个 cell 不带 flex:1 也行, 但 5 个 cell 各占 1/5 视觉更稳
  },
  tap: {
    alignItems: "center",
    paddingVertical: 2,
    paddingHorizontal: 4,
  },
  dotWrap: {
    width: DOT + 4,
    height: DOT + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  dotDone: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: theme.color.ink,
  },
  currentWrap: {
    width: DOT + 4,
    height: DOT + 4,
    alignItems: "center",
    justifyContent: "center",
  },
  dotHalo: {
    position: "absolute",
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    backgroundColor: theme.color.ink,
  },
  dotCurrent: {
    width: DOT,
    height: DOT,
    borderRadius: DOT / 2,
    borderWidth: 1.5,
    borderColor: theme.color.ink,
    backgroundColor: theme.color.paper,
  },
  dotFuture: {
    width: DOT - 2,
    height: DOT - 2,
    borderRadius: (DOT - 2) / 2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.muted2,
    backgroundColor: theme.color.paper,
  },
  label: {
    marginTop: 3,
    letterSpacing: 1,
  },
  labelActive: {
    color: theme.color.ink,
  },
  labelFuture: {
    color: theme.color.muted2,
  },
  rule: {
    flex: 1,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ink,
    marginHorizontal: 4,
  },
  ruleSoft: {
    backgroundColor: theme.color.ruleSoft,
  },
});
