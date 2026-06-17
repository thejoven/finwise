import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  SectionHeader,
  Serif,
  Sans,
  TapEffect,
} from "@/shared/components";
import { theme } from "@/core/theme";
import i18n from "@/core/i18n";
import { getSignal, reinferSignal } from "@/core/api/signals";
import { formatLongDate } from "@/shared/format";
import { useRetryPending, usePendingSignals } from "@/features/capture";
import {
  BeneficiarySilence,
  BeneficiaryTargetCard,
  DistilledContent,
  LearningCard,
  RefinementHistory,
  useDistillation,
  useRefinementBySignal,
  useSignalResearch,
  useStartRefinement,
} from "@/features/refinement";
import { GateFeedback, useGateByRefinement } from "@/features/archive";
import { SignalTrackSection } from "@/features/track";
import { ProjectBadge } from "@/features/project/ProjectBadge";

/**
 * 信号详情 — 从 inbox 列表点进来.
 *
 * 数据来源:
 *   1) 优先用 local pending (UUID 还没成功 POST 时, server 404)
 *   2) 否则 GET /v1/signals/{id} 拉服务端版本
 *
 * 视觉: 报刊式. 顶部"返回" + 卷期戳, 中部 raw_text 大字, 下面推演摘要/标签.
 */
export default function SignalDetailScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pendingItem = usePendingSignals((s) => (id ? s.items[id] : undefined));
  const retry = useRetryPending();
  const { start: startRefinement, isStarting } = useStartRefinement();

  const queryClient = useQueryClient();
  const {
    data: signal,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["signal", id],
    queryFn: () => getSignal(id!),
    enabled: !!id && !pendingItem,
    retry: 1,
    // status='pending' 时每 5s 一拉, 等 mastra 回填 inference_status='done'
    refetchInterval: (q) => (q.state.data?.inference_status === "pending" ? 5_000 : false),
  });

  // 推演卡住时, 用户点击重试 → POST /v1/signals/:id/reinfer.
  // 成功 → 立即 invalidate, 让 query 重新拉一次 (顺便重启 60s 计时).
  const reinferMutation = useMutation({
    mutationFn: () => reinferSignal(id!),
    onSuccess: async () => {
      // 重置本地计时基线 — 用户希望按钮消失给 LLM 一些时间再判
      setReinferAt(Date.now());
      await queryClient.invalidateQueries({ queryKey: ["signal", id] });
    },
  });

  // 重新计时锚: 默认是 captured_at, 用户点过重试后变成 reinferAt
  const [reinferAt, setReinferAt] = useState<number | null>(null);

  // 拉该信号上最近一次已完成的五轮追问 (没有 → null, 不报错)
  const historyQuery = useRefinementBySignal(pendingItem ? undefined : id);
  const history = historyQuery.data ?? null;

  // 拉该信号对应的全部"相关线索" (Analyst 背景检索 + 各轮 Socratic 定向检索)
  const researchQuery = useSignalResearch(pendingItem ? undefined : id);

  // 拉该信号 refinement 对应的分析师评审结果 (完成后异步触发, 可能 5-30s 才回填)
  const refinementCompleted = history?.status === "completed";
  const gateQuery = useGateByRefinement(refinementCompleted ? history?.id : undefined);

  // 降噪页结果 (降噪综述 + 受益标的). 只有走完五轮追问 → 降噪页 的信号才有.
  const distillationQuery = useDistillation(refinementCompleted ? history?.id : undefined);
  const distillation = distillationQuery.data ?? null;

  const canRefine = !pendingItem && signal?.inference_status === "done";

  const handleStartRefinement = async () => {
    if (!id) return;
    try {
      const session = await startRefinement({ primary_signal_id: id });
      router.push(`/refinement/${session.id}`);
    } catch (err) {
      // inline 反馈 — 不弹 dialog. 网络问题会被 ky retry 2 次, 失败到这里是真的不通.
      // 简单处理: log + 静默. UI 不变化, 用户再点一次即可.
      console.warn("[refinement] start failed:", err);
    }
  };

  if (!id) {
    return (
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <Header />
        <View style={styles.empty}>
          <Serif size={13} italic style={styles.muted}>
            {t("gate.signal.empty")}
          </Serif>
        </View>
      </SafeAreaView>
    );
  }

  const rawText = pendingItem?.raw_text ?? signal?.raw_text;
  const capturedAt = pendingItem?.captured_at ?? signal?.captured_at;
  const inferenceStatus = pendingItem ? "pending" : signal?.inference_status;
  const summary = signal?.inference_summary ?? null;
  const tags = signal?.inference_tags ?? [];
  // Analyst 第一层推演出的相关标的 (金融分析).
  const relatedAssets = signal?.related_assets ?? [];
  // 该信号所属分类: 本地 pending 或服务端返回的 project_id (未分类 → null)
  const projectId = pendingItem?.project_id ?? signal?.project_id ?? null;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header />
      <ScrollView contentContainerStyle={styles.scroll}>
        {capturedAt ? (
          <Mono size={10} style={styles.date}>
            {formatLongDate(capturedAt)}
          </Mono>
        ) : null}

        <ProjectBadge projectId={projectId} />

        {rawText ? (
          <Display size={22} style={styles.rawText}>
            {rawText}
          </Display>
        ) : isLoading ? (
          <Serif size={13} italic style={styles.muted}>
            {t("gate.signal.loading")}
          </Serif>
        ) : isError ? (
          <Serif size={13} italic style={styles.error}>
            {t("gate.signal.loadFailed")}
          </Serif>
        ) : null}

        <DoubleRule />

        <View style={styles.statusBlock}>
          <SectionHeader
            label={t("gate.signal.inference.title")}
            meta={statusLabel(inferenceStatus)}
          />
          {summary ? (
            <Serif size={14} style={styles.summary}>
              {summary}
            </Serif>
          ) : (
            <Serif size={12} italic style={styles.muted}>
              {inferenceStatus === "failed"
                ? t("gate.signal.inference.failed")
                : t("gate.signal.inference.pending")}
            </Serif>
          )}

          {/*
            推演卡住 (pending > 60s) 显示重试按钮.
            真因通常是 LLM 概率性输出 schema 不合 → 进 DLQ.
            点击 → POST /signals/:id/reinfer, mastra 重新消费.
          */}
          {inferenceStatus === "pending" && !pendingItem && capturedAt ? (
            <PendingRetry
              capturedAt={capturedAt}
              reinferAt={reinferAt}
              busy={reinferMutation.isPending}
              onRetry={() => reinferMutation.mutate()}
            />
          ) : null}

          {tags.length > 0 ? (
            <View style={styles.tagRow}>
              {tags.map((t) => (
                <View key={t} style={styles.tagChip}>
                  <Sans size={10} weight="500" style={styles.tagText}>
                    {t}
                  </Sans>
                </View>
              ))}
            </View>
          ) : null}
        </View>

        <FinancialTargets assets={relatedAssets} />

        {/* 标的走势 (P3): 各标的 sparkline + 发现至今 %. 仅当有可追踪标的才出区块. */}
        <SignalTrackSection signalId={id} />

        {pendingItem?.status === "failed" || pendingItem?.status === "exhausted" ? (
          <TapEffect
            style={styles.retryButton}
            pressedStyle={{ backgroundColor: theme.color.ink2 }}
            onPress={() => void retry(pendingItem)}
          >
            <Sans size={11} weight="700" style={styles.retryLabel}>
              {t("gate.signal.retryUpload")}
            </Sans>
          </TapEffect>
        ) : null}

        {canRefine ? (
          <TapEffect
            style={styles.refineButton}
            pressedStyle={{ backgroundColor: theme.color.ink2 }}
            onPress={() => void handleStartRefinement()}
            disabled={isStarting}
          >
            <Sans size={11} weight="700" style={styles.refineLabel}>
              {isStarting
                ? t("gate.signal.refine.preparing")
                : history
                  ? t("gate.signal.refine.again")
                  : t("gate.signal.refine.start")}
            </Sans>
          </TapEffect>
        ) : null}

        {history && history.rounds && history.rounds.length > 0 ? (
          <View style={styles.historyBlock}>
            <RefinementHistory
              rounds={history.rounds}
              decision={history.decision}
              completedAt={history.completed_at ?? history.started_at}
            />
          </View>
        ) : null}

        {/* 降噪页结果: 降噪综述 + 受益标的 (走完五轮追问 → 降噪页 的信号才有) */}
        {distillation && (distillation.distilled_content || distillation.beneficiary != null) ? (
          <View style={styles.distillBlock}>
            {distillation.distilled_content ? (
              <View>
                <SectionHeader
                  label={t("gate.signal.distill.label")}
                  meta={t("gate.signal.distill.meta")}
                />
                <DoubleRule />
                <DistilledContent content={distillation.distilled_content} />
              </View>
            ) : null}
            {distillation.beneficiary != null ? (
              <View style={styles.beneficiaryBlock}>
                <SectionHeader
                  label={t("gate.signal.distill.beneficiaryLabel")}
                  meta={t("gate.signal.distill.beneficiaryMeta")}
                />
                <DoubleRule />
                {distillation.beneficiary.length > 0 ? (
                  <View style={styles.beneficiaryList}>
                    {distillation.beneficiary_note ? (
                      <Serif size={14} italic style={styles.beneficiaryNote}>
                        {distillation.beneficiary_note}
                      </Serif>
                    ) : null}
                    {distillation.beneficiary.map((t, i) => (
                      <BeneficiaryTargetCard key={`${t.symbol}-${i}`} target={t} />
                    ))}
                  </View>
                ) : (
                  <BeneficiarySilence note={distillation.beneficiary_note ?? null} />
                )}
              </View>
            ) : null}
          </View>
        ) : null}

        {/*
          相关线索: 这条信号"回答过程中"系统检索的全部材料
          (Analyst 阶段 broad search + 各轮 Socratic lens-定向 search).
          默认折叠在底部, 一致体验 — 想回看推演依据的人主动展开.
          研究还没到位或为空时 LearningCard 自身会渲染对应状态.
        */}
        {!pendingItem && id ? (
          <LearningCard items={researchQuery.data?.items} loading={researchQuery.isLoading} />
        ) : null}

        {/*
          分析师评审反馈 — 只在五轮追问已完成时显示.
          refinement 完成 → gate.Evaluate 异步触发; evaluation 可能晚 5-30s 才到.
          这期间 GateFeedback 内部自显 "等待评估" 占位.
        */}
        {refinementCompleted ? (
          <GateFeedback evaluation={gateQuery.data} refinementCompleted={true} />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  );
}

/** order 枚举 → 完整 i18n key (字面量, 让 t() 仍受类型检查). */
const ORDER_I18N = {
  first: "gate.signal.financial.orderFirst",
  second: "gate.signal.financial.orderSecond",
  third: "gate.signal.financial.orderThird",
} as const;

/** 金融分析 — Analyst 第一层推演出的相关标的 (ticker + 一阶/二阶/三阶 + 理由). */
function FinancialTargets({
  assets,
}: {
  assets: { ticker: string; rationale: string; order: string }[];
}) {
  const { t } = useTranslation();
  if (assets.length === 0) return null;
  return (
    <View style={styles.faBlock}>
      <SectionHeader
        label={t("gate.signal.financial.label")}
        meta={t("gate.signal.financial.meta")}
      />
      <DoubleRule />
      <View style={styles.faList}>
        {assets.map((a, i) => {
          const orderKey = ORDER_I18N[a.order as keyof typeof ORDER_I18N];
          return (
            <View key={`${a.ticker}-${i}`} style={styles.faItem}>
              <View style={styles.faHead}>
                <Mono size={12} style={styles.faTicker}>
                  {a.ticker}
                </Mono>
                {orderKey ? (
                  <Sans size={9} weight="700" style={styles.faOrder}>
                    {t(orderKey)}
                  </Sans>
                ) : null}
              </View>
              {a.rationale ? (
                <Serif size={13} style={styles.faRationale}>
                  {a.rationale}
                </Serif>
              ) : null}
            </View>
          );
        })}
      </View>
    </View>
  );
}

/**
 * PendingRetry — pending > 60s 时露出的"卡住了, 重试"按钮.
 * 用 ref + setInterval 每秒重算; 不引入复杂 hooks.
 *
 * 计时锚: 优先用 reinferAt (用户点过重试后的时间), 否则 captured_at.
 * 这样按钮点击后 60s 内自动隐藏, 让 LLM 有时间跑.
 */
function PendingRetry({
  capturedAt,
  reinferAt,
  busy,
  onRetry,
}: {
  capturedAt: string;
  reinferAt: number | null;
  busy: boolean;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  // 每秒自重渲 — 让"是否超过 60s"的判断实时
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const anchorMs = reinferAt ?? new Date(capturedAt).getTime();
  const elapsedSec = Math.max(0, Math.floor((now - anchorMs) / 1000));
  if (elapsedSec < 60) return null;

  return (
    <View style={styles.retryStuckBlock}>
      <Serif size={12} italic style={styles.retryStuckHint}>
        {t("gate.signal.stuck.hint", { seconds: elapsedSec })}
      </Serif>
      <TapEffect
        style={[styles.retryStuckButton, busy && styles.retryStuckButtonBusy]}
        pressedStyle={busy ? undefined : { backgroundColor: theme.color.ink2 }}
        onPress={busy ? undefined : onRetry}
        disabled={busy}
      >
        <Sans size={11} weight="700" style={styles.retryStuckLabel}>
          {busy ? t("gate.signal.stuck.retrying") : t("gate.signal.stuck.retry")}
        </Sans>
      </TapEffect>
    </View>
  );
}

function statusLabel(status: string | undefined): string {
  switch (status) {
    case "done":
      return i18n.t("gate.signal.inference.statusDone");
    case "pending":
      return i18n.t("gate.signal.inference.statusPending");
    case "failed":
      return i18n.t("gate.signal.inference.statusFailed");
    default:
      return "";
  }
}

function Header() {
  const { t } = useTranslation();
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>{t("gate.signal.back")}</Serif>
      </TapEffect>
      <Sans size={9} weight="600" style={styles.headerStamp}>
        {t("gate.signal.headerStamp")}
      </Sans>
      <View style={styles.headerSpacer} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 64,
  },
  headerStamp: {
    flex: 1,
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
  },
  headerSpacer: {
    minWidth: 64,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  date: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  rawText: {
    color: theme.color.ink,
    marginVertical: theme.spacing.sm,
  },
  statusBlock: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  summary: {
    color: theme.color.ink2,
  },
  muted: {
    color: theme.color.muted,
  },
  error: {
    color: theme.color.red,
  },
  tagRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  tagChip: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.ink2,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 3,
  },
  tagText: {
    color: theme.color.ink2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  retryStuckBlock: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.sm,
    paddingTop: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  retryStuckHint: {
    color: theme.color.muted,
    lineHeight: 20,
  },
  retryStuckButton: {
    alignSelf: "flex-start",
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    backgroundColor: theme.color.ink,
  },
  retryStuckButtonBusy: {
    backgroundColor: theme.color.muted2,
  },
  retryStuckLabel: {
    color: theme.color.paper,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  retryButton: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.color.ink,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  retryLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  refineButton: {
    marginTop: theme.spacing.lg,
    backgroundColor: theme.color.ink,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  refineLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  historyBlock: {
    marginTop: theme.spacing.xl,
  },
  empty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.lg,
  },
  faBlock: {
    marginTop: theme.spacing.md,
  },
  faList: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  faItem: {
    gap: 2,
  },
  faHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  faTicker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  faOrder: {
    color: theme.color.paper,
    backgroundColor: theme.color.ink2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    letterSpacing: 1,
    overflow: "hidden",
  },
  faRationale: {
    color: theme.color.ink2,
    lineHeight: 19,
  },
  distillBlock: {
    marginTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  beneficiaryBlock: {
    marginTop: theme.spacing.lg,
  },
  beneficiaryList: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  beneficiaryNote: {
    color: theme.color.muted,
    lineHeight: 22,
    marginBottom: theme.spacing.xs,
  },
});
