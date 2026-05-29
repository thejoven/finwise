/**
 * 五轮追问对话页 (M5) · v3 长滚动 + 步进条版.
 *
 * 设计:
 *   - 顶部固定 5 dot 步进条 (RefinementSteps): 已答=实心ink, 当前=ink环, 未来=灰
 *     点击任何**已答 / 当前**点 → 跳转到对应卡片顶部
 *   - 整页一个垂直长滚动 ScrollView
 *   - 已答历史 (session.rounds) 渲染为 AnsweredRoundCard 列表, 完整保留题目 +
 *     答案高亮
 *   - 当前 pending_question 用 emphasized 样式 (paper3 背景 + 1.5 ink border +
 *     左侧 4px ink 竖条) 让用户在长滚动里一眼看到
 *   - 等下一题时 WaitingForNext (typewriter + 三 dot pulse + shimmer rule)
 *   - 进入页面 / 切轮自动 scroll 到 pending; 用 onContentSizeChange 触发, 等
 *     layout 稳定再滚, 避免 race
 *
 *   - "相关线索" header 右侧 pill 触发 CluesDrawer (右侧 85% 抽屉)
 *
 * 严格遵守产品哲学: 等待用 Typewriter, 提交不弹 toast, 完成不显示"恭喜".
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type LayoutChangeEvent,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft } from "lucide-react-native";

import { DoubleRule, Mono, Sans, SectionHeader, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { reinferQuestion } from "@/core/api/refinement";

import {
  AnsweredRoundCard,
  CluesDrawer,
  CluesTrigger,
  QuestionCard,
  RefinementSteps,
  RoundDivider,
  WaitingForNext,
  computeDiagnosis,
  useRefinementSession,
  useSessionResearch,
  useSubmitAnswer,
} from "@/features/refinement";
import type { UserAnswer } from "@/core/api/refinement";

// pending / waiting 在 roundYs map 里用这个特殊 key 标记
const CURRENT_KEY = 99;

export default function RefinementScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data: session, isError, refetch } = useRefinementSession(sessionId);
  const completed = session?.status === "completed";
  const { data: research, isLoading: researchLoading } = useSessionResearch(sessionId, {
    stop: completed,
  });
  const { submit, isSubmitting } = useSubmitAnswer(sessionId);

  // 等下一题卡住 → 用户主动重试出题 (server 重发 refinement.answered, mastra 重跑 socratic)
  const queryClient = useQueryClient();
  const reinferQuestionMutation = useMutation({
    mutationFn: () => reinferQuestion(sessionId!),
    onSuccess: async () => {
      // 重置 retry 计时锚
      setRetryAnchor(Date.now());
      if (sessionId) {
        await queryClient.invalidateQueries({ queryKey: ["refinement", sessionId] });
      }
    },
  });
  const [retryAnchor, setRetryAnchor] = useState<number | null>(null);

  const [pendingAnswer, setPendingAnswer] = useState<UserAnswer | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<ScrollView | null>(null);

  // 每个 round block 的 layout y; key 是 round 号 (1..5), CURRENT_KEY 是当前/等题块.
  // onLayout 时写入; 步进条 tap 和 auto-scroll 都查这张表.
  const roundYs = useRef<Record<number, number>>({});

  const lastSeenRound = useRef<number>(0);
  const didInitialScroll = useRef<boolean>(false);

  const pendingQuestion = session?.pending_question;
  const answeredRounds = session?.rounds ?? [];
  const roundsDone = session?.rounds_done ?? 0;

  // 切题 → 重置上一题残留的 pendingAnswer
  useEffect(() => {
    if (!pendingQuestion) return;
    if (pendingQuestion.round !== lastSeenRound.current) {
      setPendingAnswer(null);
    }
  }, [pendingQuestion]);

  // 切轮 / 首次 mount 标记 → 触发 auto-scroll. 真正的 scroll 在 onContentSizeChange 里
  // 等 layout 稳定再做, 避免 onLayout 还没收到 y 就 scrollTo 0 的 race.
  const needsAutoScroll = useRef<boolean>(false);
  useEffect(() => {
    if (!session) return;
    const currentRound = pendingQuestion?.round ?? -1;
    const isNewRound = currentRound !== lastSeenRound.current;
    const isFirstMount =
      !didInitialScroll.current && (answeredRounds.length > 0 || !pendingQuestion);
    if (!isNewRound && !isFirstMount) return;
    lastSeenRound.current = currentRound;
    didInitialScroll.current = true;
    needsAutoScroll.current = true;
  }, [pendingQuestion, session, answeredRounds.length]);

  // scrollTo 的核心 — 找 round 对应 y, 滚到顶上 16px 缓冲位.
  // 如果 y 还没拿到 (= 0 且不是真的 0), 等下一帧再试.
  const scrollToRound = useCallback((roundOrCurrent: number, animated = true) => {
    const y = roundYs.current[roundOrCurrent];
    if (y === undefined) return;
    scrollRef.current?.scrollTo({ y: Math.max(0, y - 16), animated });
  }, []);

  // content size 稳定后, 如果有 auto-scroll 需求 → 滚到底.
  // 用 scrollToEnd 而不是滚到 pending 块顶: 用户第二次打开页面时, 历史 round
  // 可能已经撑了很多高度, 落在 pending 顶部用户只看到题目标题, 看不到选项+提交
  // 按钮. scrollToEnd 让 pending 块尾贴屏底, 用户直接看到要做的事.
  const handleContentSizeChange = useCallback(() => {
    if (!needsAutoScroll.current) return;
    needsAutoScroll.current = false;
    if (completed) return; // 完成态不滚 — Completed block 自己是顶
    scrollRef.current?.scrollToEnd({ animated: didInitialScroll.current });
  }, [completed]);

  // 顶部步进条 tap 跳转
  const handleStepTap = useCallback(
    (round: number) => {
      // 当前轮 (= roundsDone + 1, 不论是 pending 还是 waiting) → 跳 CURRENT_KEY
      const isCurrent = round === roundsDone + 1 && !completed;
      scrollToRound(isCurrent ? CURRENT_KEY : round);
    },
    [roundsDone, completed, scrollToRound],
  );

  // 长文本输入改成弹 Modal (TextInputModal), QuestionCard 内自管 — refinement
  // 屏不再有内联 TextInput, 不需要键盘 aware scroll.

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

  const makeLayoutCapture = useCallback(
    (key: number) => (e: LayoutChangeEvent) => {
      roundYs.current[key] = e.nativeEvent.layout.y;
    },
    [],
  );

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

      {/* 顶部固定步进条 — 永远可见, 让用户在长滚动里知道自己在哪一轮 */}
      <RefinementSteps
        roundsDone={roundsDone}
        hasPending={!!pendingQuestion}
        completed={!!completed}
        onTapStep={handleStepTap}
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
          onContentSizeChange={handleContentSizeChange}
        >
          {isError ? (
            <Serif size={13} italic style={styles.error}>
              读取这次追问遇到了问题, 下拉或稍后再开.
            </Serif>
          ) : (
            <>
              {/* 已答历史 — 完整保留题目 + 答案 (用户偏好) */}
              {answeredRounds.map((r, idx) => (
                <View key={r.round}>
                  {idx > 0 ? <RoundDivider round={r.round} /> : null}
                  <View style={styles.roundBlock} onLayout={makeLayoutCapture(r.round)}>
                    <AnsweredRoundCard round={r} />
                  </View>
                </View>
              ))}

              {/* 完成态 / 当前题 / 等下一题 */}
              {completed ? (
                <Completed decision={session?.decision} />
              ) : pendingQuestion ? (
                <View style={styles.pendingBlock} onLayout={makeLayoutCapture(CURRENT_KEY)}>
                  {/* 顶部一条红 rule + Mono "当前" stamp — 报刊感的 "now reading" */}
                  <View style={styles.pendingTopRule} />
                  <Mono size={9} style={styles.pendingStamp}>
                    {`◆ 当前 · ROUND ${pendingQuestion.round}`}
                  </Mono>
                  {/* key 强制每题 fresh mount, 防止 QuestionCard 内部 useState 跨轮残留 */}
                  <QuestionCard
                    key={pendingQuestion.payload.question_id}
                    question={pendingQuestion.payload}
                    onAnswerChange={setPendingAnswer}
                  />
                </View>
              ) : (
                <View style={styles.pendingBlock} onLayout={makeLayoutCapture(CURRENT_KEY)}>
                  <View style={styles.pendingTopRule} />
                  <Mono size={9} style={styles.pendingStamp}>
                    {`◆ 当前 · ROUND ${roundsDone + 1}`}
                  </Mono>
                  <WaitingForNext
                    stamp={undefined}
                    text={roundsDone > 0 ? "你的答案收到了. 正在出下一题…" : "正在准备第一道题…"}
                    retryAnchor={
                      // 计时锚: 最近一轮回答时间 (有时), 否则 session 开始时间.
                      // R1 出题阶段不显示 retry — 这条路径暂不支持 (refinement.started reinfer).
                      retryAnchor ??
                      (roundsDone > 0 && answeredRounds.length > 0
                        ? answeredRounds[answeredRounds.length - 1]!.answered_at
                        : null)
                    }
                    onRetry={() => reinferQuestionMutation.mutate()}
                    retryBusy={reinferQuestionMutation.isPending}
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
  // 当前题 / 等下一题 — 报刊"now reading"卡片. 顶部 red rule + Mono stamp,
  // 浅 paper2 背景做温和强调, 没有重边框 (避免工业感).
  pendingBlock: {
    marginTop: theme.spacing.md,
    paddingBottom: theme.spacing.lg,
    backgroundColor: theme.color.paper2,
  },
  pendingTopRule: {
    height: 2,
    backgroundColor: theme.color.red,
  },
  pendingStamp: {
    color: theme.color.red,
    letterSpacing: 2,
    textTransform: "uppercase",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
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
