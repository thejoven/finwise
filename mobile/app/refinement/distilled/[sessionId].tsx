/**
 * 降噪页 (单独页面) · 五轮追问完成后落地.
 *
 * 刻意 gate 在追问之后 (产品需求): 先逼用户做认知的 reps, 再给降噪综述 + 金融
 * 受益信号, 避免认知惰性.
 *
 * 两块内容由 mastra post-refinement 异步写回, 各自先到先显示:
 *   1. 降噪综述 (distilled_content) — distiller agent
 *   2. 收益标的信号 (beneficiary)   — beneficiary agent (拉实时检索, 慢一点)
 *
 * "前置于投决会": 页底由用户决定是否"上投决会"评审 — 不自动跑.
 *
 * 严格遵守产品哲学: 等待用 typewriter, 不弹 toast, 不显示 spinner / loading.
 */

import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

import { DoubleRule, Icon, Mono, Sans, SectionHeader, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

import {
  BeneficiarySilence,
  BeneficiaryTargetCard,
  DistilledContent,
  TypewriterText,
  WaitingForNext,
  useDistillation,
  useProceedToGate,
} from "@/features/refinement";
import type { BeneficiaryTarget } from "@/core/api/distillation";

export default function DistilledScreen() {
  const { sessionId } = useLocalSearchParams<{ sessionId: string }>();
  const { data } = useDistillation(sessionId);
  const { proceed, isProceeding } = useProceedToGate();

  const distilled = data?.distilled_content ?? null;
  const beneficiary = data?.beneficiary ?? null;
  const beneficiaryPending = !data || data.beneficiary == null;
  const note = data?.beneficiary_note ?? null;

  const onProceed = async () => {
    if (!sessionId) return;
    try {
      await proceed(sessionId);
    } catch {
      // 静默: 失败不弹 toast. 评估是 detached 的, 回到收件箱后照常 (或不) 浮现.
    }
    router.replace("/(tabs)/caizhi");
  };

  return (
    <SafeAreaView style={styles.safe} edges={["top", "bottom"]}>
      <Header sessionId={sessionId} />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* ── 降噪综述 ── */}
        <SectionHeader label="降噪" meta="这条信号" />
        <DoubleRule />
        {distilled ? (
          <DistilledContent content={distilled} />
        ) : (
          <WaitingForNext stamp="DISTILLING" text="正在把噪音滤掉…" />
        )}

        {/* ── 收益标的信号 (异步) ── */}
        <View style={styles.beneficiarySection}>
          <SectionHeader label="收益标的" meta="金融推演" />
          <DoubleRule />
          {beneficiaryPending ? (
            <WaitingForNext stamp="ANALYSING" text="金融受益链还在推演…" />
          ) : beneficiary && beneficiary.length > 0 ? (
            <BeneficiarySignal note={note} targets={beneficiary} />
          ) : (
            <BeneficiarySilence note={note} />
          )}
        </View>
      </ScrollView>

      <Footer onProceed={onProceed} isProceeding={isProceeding} />
    </SafeAreaView>
  );
}

// ─────────────────────── Header ───────────────────────

function Header({ sessionId }: { sessionId?: string }) {
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>返回</Serif>
      </TapEffect>
      <View style={styles.headerCenter}>
        <Sans size={9} weight="600" style={styles.headerStamp}>
          VOL. I · 降噪
        </Sans>
        <Mono size={9} style={styles.headerProgress}>
          {sessionId ? sessionId.slice(0, 8).toUpperCase() : ""}
        </Mono>
      </View>
      <View style={styles.headerRight} />
    </View>
  );
}

// ─────────────────────── 收益标的信号 ───────────────────────

function BeneficiarySignal({
  note,
  targets,
}: {
  note: string | null;
  targets: BeneficiaryTarget[];
}) {
  return (
    <View style={styles.beneficiaryBody}>
      {/* note 用 typewriter 显现 — 异步信号到达的"打字机"感 (不是 spinner). */}
      {note ? (
        <TypewriterText text={note} italic size={14} speedMs={18} style={styles.note} />
      ) : null}
      {targets.map((t, i) => (
        <BeneficiaryTargetCard key={`${t.symbol}-${i}`} target={t} />
      ))}
    </View>
  );
}

// ─────────────────────── Footer ───────────────────────

function Footer({ onProceed, isProceeding }: { onProceed: () => void; isProceeding: boolean }) {
  return (
    <View style={styles.footer}>
      <TapEffect
        style={[styles.primaryButton, isProceeding ? styles.primaryButtonBusy : null]}
        pressedStyle={isProceeding ? undefined : { backgroundColor: theme.color.ink2 }}
        onPress={isProceeding ? undefined : onProceed}
        disabled={isProceeding}
      >
        <Sans size={11} weight="700" style={styles.primaryLabel}>
          {isProceeding ? "正在上会…" : "上投决会"}
        </Sans>
      </TapEffect>
      <TapEffect
        style={styles.secondaryButton}
        onPress={() => router.replace("/(tabs)/caizhi")}
        disableEffect
      >
        <Serif size={13} style={styles.secondaryLabel}>
          先放着
        </Serif>
      </TapEffect>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    minWidth: 56,
  },
  headerCenter: {
    alignItems: "center",
  },
  headerStamp: {
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
  },
  headerProgress: {
    color: theme.color.muted2,
    letterSpacing: 1,
  },
  headerRight: {
    minWidth: 56,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  beneficiarySection: {
    marginTop: theme.spacing.xxl,
  },
  // 收益标的 (note 给 BeneficiarySignal 的 typewriter 用; 卡片样式在 DistillationView)
  beneficiaryBody: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  note: {
    color: theme.color.muted,
    lineHeight: 22,
    marginBottom: theme.spacing.xs,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
    gap: theme.spacing.sm,
    backgroundColor: theme.color.paper,
  },
  primaryButton: {
    backgroundColor: theme.color.ink,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  primaryButtonBusy: {
    backgroundColor: theme.color.muted2,
  },
  primaryLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  secondaryButton: {
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
  secondaryLabel: {
    color: theme.color.muted,
  },
});
