/**
 * 五轮追问对话页 (M5) · v2 长滚动版.
 *
 * 设计 (替换 v1 单题切换):
 *   - 整页一个垂直长滚动 ScrollView
 *   - 已答历史 (session.rounds) 渲染为 AnsweredRoundCard 列表, 完整保留题目 +
 *     答案高亮 (用户选的项 ink 边框, 未选项灰化)
 *   - 列表底部是**当前 pending_question** 的 QuestionCard, 用户答完往下顺势
 *     就到 footer "提交这一轮" 按钮
 *   - 等下一题时 (没有 pending_question 但 session.active): typewriter 占位
 *   - 提交后自动 scroll 到新出现的题目 / typewriter 区域
 *
 *   - "相关线索" 不再嵌底部 — 由 header 右侧 CluesTrigger pill 触发 CluesDrawer
 *     (85% 宽度右侧抽屉)
 *
 * 严格遵守产品哲学:
 *   - 等待用 TypewriterText, 不用 ActivityIndicator
 *   - 提交不弹 toast
 *   - 完成不显示"恭喜", 用 SectionHeader + 决定结果 + "回到收件箱"
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { ChevronLeft } from "lucide-react-native";

import { DoubleRule, Mono, Sans, SectionHeader, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

import {
  AnsweredRoundCard,
  CluesDrawer,
  CluesTrigger,
  QuestionCard,
  WaitingForNext,
  computeDiagnosis,
  useRefinementSession,
  useSessionResearch,
  useSubmitAnswer,
} from "@/features/refinement";
import type { UserAnswer } from "@/core/api/refinement";

export default function RefinementScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data: session, isError, refetch } = useRefinementSession(sessionId);
  const completed = session?.status === "completed";
  const { data: research, isLoading: researchLoading } = useSessionResearch(sessionId, {
    stop: completed,
  });
  const { submit, isSubmitting } = useSubmitAnswer(sessionId);

  const [pendingAnswer, setPendingAnswer] = useState<UserAnswer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);
  // 当前轮的卡片 layout y (用于 auto-scroll). 每当 round 数变化记录新 y.
  const currentRoundY = useRef<number>(0);
  const lastSeenRound = useRef<number>(0);
  // 首次 mount 后是否已经做过初始滚动 — 防止重复 jump.
  const didInitialScroll = useRef<boolean>(false);

  const pendingQuestion = session?.pending_question;
  const answeredRounds = session?.rounds ?? [];
  const roundsDone = session?.rounds_done ?? 0;

  // 切题/上题切换 → 重置上一题残留的 pendingAnswer (核心 bug 修: 没这步,
  // 用户进 R2 时还带着 R1 答案的内存, 提交逻辑错位)
  useEffect(() => {
    if (!pendingQuestion) return;
    if (pendingQuestion.round !== lastSeenRound.current) {
      setPendingAnswer(null);
    }
  }, [pendingQuestion]);

  // 新一轮题到位 / 首次 mount 有历史 → 自动 scroll 让用户落到"当前等做"的位置
  useEffect(() => {
    if (!session) return;

    const currentRound = pendingQuestion?.round ?? -1;
    const isNewRound = currentRound !== lastSeenRound.current;
    const isFirstMount =
      !didInitialScroll.current && (answeredRounds.length > 0 || !pendingQuestion);

    if (!isNewRound && !isFirstMount) return;

    lastSeenRound.current = currentRound;
    didInitialScroll.current = true;

    // 双 raf 等 onLayout 拿到稳定 y
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        // 等下一题 (无 pending) → 滚到底 ; 有 pending → 把新题顶到屏幕上方
        if (!pendingQuestion) {
          scrollRef.current?.scrollToEnd({ animated: true });
        } else {
          scrollRef.current?.scrollTo({
            y: Math.max(0, currentRoundY.current - 16),
            animated: true,
          });
        }
      });
    });
  }, [pendingQuestion, session, answeredRounds.length]);

  // user_input / open 题型 focus 键盘时让 footer 露出来
  const handleInputFocus = useCallback(() => {
    setTimeout(() => {
      scrollRef.current?.scrollToEnd({ animated: true });
    }, 200);
  }, []);

  const handleSubmit = useCallback(async () => {
    if (!pendingQuestion || !pendingAnswer) return;
    const diagnosis = computeDiagnosis({
      kind: pendingQuestion.payload.kind,
      options: pendingQuestion.payload.options,
      answer: pendingAnswer,
    });
    await submit({
      round: pendingQuestion.payload.round,
      question_id: pendingQuestion.payload.question_id,
      question_kind: pendingQuestion.payload.kind,
      question_text: pendingQuestion.payload.text,
      options: pendingQuestion.payload.options,
      user_answer: pendingAnswer,
      diagnosis,
    });
    setPendingAnswer(null);
    await refetch();
  }, [pendingQuestion, pendingAnswer, submit, refetch]);

  const canSubmit = !!pendingAnswer && !isSubmitting && !!pendingQuestion;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header
        sessionId={sessionId}
        roundsDone={roundsDone}
        cluesTrigger={
          <CluesTrigger
            items={research?.items}
            loading={researchLoading}
            onPress={() => setDrawerOpen(true)}
          />
        }
      />

      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="interactive"
          automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        >
          {isError ? (
            <Serif size={13} italic style={styles.error}>
              读取这次追问遇到了问题, 下拉或稍后再开.
            </Serif>
          ) : (
            <>
              {/* 已答历史 — v1 改 v2 的核心: 往上滚能看到之前几轮 */}
              {answeredRounds.map((r) => (
                <View key={r.round} style={styles.roundBlock}>
                  <AnsweredRoundCard round={r} />
                </View>
              ))}

              {/* 完成态 / 当前题 / 等下一题 */}
              {completed ? (
                <Completed decision={session?.decision} />
              ) : pendingQuestion ? (
                <View
                  style={styles.roundBlock}
                  onLayout={(e) => {
                    currentRoundY.current = e.nativeEvent.layout.y;
                  }}
                >
                  {/* key 强制每题 fresh mount, 防止 QuestionCard 内部 useState 跨轮残留 */}
                  <QuestionCard
                    key={pendingQuestion.payload.question_id}
                    question={pendingQuestion.payload}
                    onAnswerChange={setPendingAnswer}
                    onInputFocus={handleInputFocus}
                  />
                </View>
              ) : (
                <View
                  onLayout={(e) => {
                    currentRoundY.current = e.nativeEvent.layout.y;
                  }}
                >
                  <WaitingForNext
                    stamp={
                      roundsDone > 0 ? `AWAITING · ROUND ${roundsDone + 1}` : "AWAITING · ROUND 1"
                    }
                    text={roundsDone > 0 ? "你的答案收到了. 正在出下一题…" : "正在准备第一道题…"}
                  />
                </View>
              )}
            </>
          )}
        </ScrollView>

        {!completed && pendingQuestion ? (
          <Footer canSubmit={canSubmit} onSubmit={handleSubmit} isSubmitting={isSubmitting} />
        ) : completed ? (
          <View style={styles.footer}>
            <TapEffect
              style={styles.primaryButton}
              pressedStyle={{ backgroundColor: theme.color.ink2 }}
              onPress={() => router.replace("/(tabs)/inbox")}
            >
              <Sans size={11} weight="700" style={styles.primaryLabel}>
                回到收件箱
              </Sans>
            </TapEffect>
          </View>
        ) : null}
      </KeyboardAvoidingView>

      {/* 右侧抽屉. absolute fill, pointerEvents 跟 open 走 */}
      <CluesDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        items={research?.items}
        loading={researchLoading}
      />
    </SafeAreaView>
  );
}

interface HeaderProps {
  sessionId?: string;
  roundsDone: number;
  cluesTrigger: React.ReactNode;
}

function Header({ sessionId, roundsDone, cluesTrigger }: HeaderProps) {
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <ChevronLeft size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>返回</Serif>
      </TapEffect>
      <View style={styles.headerCenter}>
        <Sans size={9} weight="600" style={styles.headerStamp}>
          VOL. I · 五轮追问
        </Sans>
        <Mono size={9} style={styles.headerProgress}>
          {sessionId ? `${sessionId.slice(0, 8).toUpperCase()} · ` : ""}
          {roundsDone}/5
        </Mono>
      </View>
      <View style={styles.headerRight}>{cluesTrigger}</View>
    </View>
  );
}

function Completed({ decision }: { decision?: string }) {
  return (
    <View style={styles.completedBlock}>
      <SectionHeader label="完成" meta={decision === "training_only" ? "训练" : "可入四道门评估"} />
      <DoubleRule />
      <Serif size={15} style={styles.completedBody}>
        {decision === "training_only"
          ? "这一次主要是训练. 你看见自己的几个盲点. 这条信号不进入四道门, 它会和你已有的观察一起被收着."
          : "这一次的认知厚度看上去够了. 系统会安静地跑一遍四道门. 你不用做什么, 等下一个时刻它会自己回到收件箱里."}
      </Serif>
    </View>
  );
}

interface FooterProps {
  canSubmit: boolean;
  onSubmit: () => void;
  isSubmitting: boolean;
}

function Footer({ canSubmit, onSubmit, isSubmitting }: FooterProps) {
  return (
    <View style={styles.footer}>
      <TapEffect
        style={[styles.primaryButton, !canSubmit && styles.primaryButtonDim]}
        pressedStyle={canSubmit ? { backgroundColor: theme.color.ink2 } : undefined}
        onPress={canSubmit ? onSubmit : undefined}
        disabled={!canSubmit}
      >
        <Sans size={11} weight="700" style={styles.primaryLabel}>
          {isSubmitting ? "正在记下..." : "提交这一轮"}
        </Sans>
      </TapEffect>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  flex: {
    flex: 1,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
    gap: theme.spacing.sm,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 60,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerStamp: {
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
  },
  headerProgress: {
    color: theme.color.muted2,
    letterSpacing: 1,
    marginTop: 2,
  },
  headerRight: {
    minWidth: 60,
    alignItems: "flex-end",
  },
  scroll: {
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxl,
  },
  roundBlock: {
    paddingBottom: theme.spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  error: {
    color: theme.color.red,
    paddingHorizontal: theme.spacing.lg,
  },
  completedBlock: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  completedBody: {
    color: theme.color.ink2,
    lineHeight: 24,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
  },
  primaryButton: {
    backgroundColor: theme.color.ink,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  primaryButtonDim: {
    backgroundColor: theme.color.muted2,
  },
  primaryLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
