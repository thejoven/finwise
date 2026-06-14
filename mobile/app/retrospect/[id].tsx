/**
 * 复盘 · 四问对话 (M11).
 *
 * 流程:
 *   - 一道一道走 RETROSPECT_QUESTIONS[0..3]
 *   - 每答完一道 POST /v1/retrospects/:id/answers, 服务端在 events + answers JSONB 累加
 *   - 第 4 道答完后, 按 "结束复盘" → POST /finalize
 *   - 服务端返回 focus_dim + focus_text, 渲染最终的"训练重点"卡, 然后 "回到收件箱"
 *
 * 进度由服务端权威保存: answers.length = 已答的题数, 客户端用它定位下一题.
 * 重开 APP 不丢: server state 是真相, useRetrospect 自动 hydrate.
 */

import { useMemo, useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TapEffect,
} from "@/shared/components";
import { NativeField } from "@/shared/native";
import { theme } from "@/core/theme";
import i18nSingleton from "@/core/i18n";

import {
  getRetrospectQuestions,
  useFinalizeRetrospect,
  useRetrospect,
  useSubmitRetrospectAnswer,
  type RetrospectQuestion,
} from "@/features/retrospect";

export default function RetrospectScreen() {
  const { t, i18n } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: retro, isLoading, isError } = useRetrospect(id);
  const { submit, isSubmitting } = useSubmitRetrospectAnswer(id);
  const { finalize, isFinalizing } = useFinalizeRetrospect(id);

  // 四问文案随语言解析; 语言切换时 i18n.language 变 → 重新取一份.
  const questions = useMemo(() => getRetrospectQuestions(), [i18n.language]);
  const currentIdx = retro ? retro.answers.length : 0;
  const finalized = retro?.state === "finalized";
  const allAnswered = (retro?.answers.length ?? 0) >= 4;
  const currentQ: RetrospectQuestion | undefined =
    currentIdx < 4 ? questions[currentIdx] : undefined;

  const [choice, setChoice] = useState<string | null>(null);
  const [openText, setOpenText] = useState("");

  const handleSubmit = async () => {
    if (!currentQ || !choice) return;
    await submit({
      question_no: currentQ.no,
      question_dim: currentQ.dim,
      choice,
      open_text: openText.trim() ? openText.trim() : undefined,
    });
    setChoice(null);
    setOpenText("");
  };

  const handleFinalize = async () => {
    try {
      await finalize();
    } catch (err) {
      console.warn("[finalize] failed:", err);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header step={currentIdx} finalized={finalized} />
      <ScrollView contentContainerStyle={styles.scroll}>
        {isLoading ? (
          <Serif size={13} italic style={styles.muted}>
            {t("retrospect.loading")}
          </Serif>
        ) : isError || !retro ? (
          <Serif size={13} italic style={styles.error}>
            {t("retrospect.error")}
          </Serif>
        ) : finalized ? (
          <Finalized retro={retro} />
        ) : currentQ ? (
          <QuestionBlock
            q={currentQ}
            choice={choice}
            openText={openText}
            onChoiceChange={setChoice}
            onOpenTextChange={setOpenText}
          />
        ) : allAnswered ? (
          <ReadyToFinalize />
        ) : null}
      </ScrollView>

      {finalized ? (
        <Footer
          label={t("retrospect.footer.backToInbox")}
          onPress={() => router.replace("/(tabs)/caizhi")}
          enabled
        />
      ) : currentQ ? (
        <Footer
          label={
            isSubmitting
              ? t("retrospect.footer.submitting")
              : currentIdx === 3
                ? t("retrospect.footer.submitLast")
                : t("retrospect.footer.submitNext")
          }
          onPress={handleSubmit}
          enabled={!!choice && !isSubmitting}
        />
      ) : allAnswered ? (
        <Footer
          label={isFinalizing ? t("retrospect.footer.finalizing") : t("retrospect.footer.finalize")}
          onPress={handleFinalize}
          enabled={!isFinalizing}
        />
      ) : null}
    </SafeAreaView>
  );
}

function Header({ step, finalized }: { step: number; finalized: boolean }) {
  const { t } = useTranslation();
  const label = finalized
    ? t("retrospect.header.finalized")
    : t("retrospect.header.step", { step: Math.min(step + 1, 4) });
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>{t("common.back")}</Serif>
      </TapEffect>
      <Sans size={9} weight="600" style={styles.headerStamp}>
        {label}
      </Sans>
      <View style={styles.headerSpacer} />
    </View>
  );
}

interface QuestionBlockProps {
  q: RetrospectQuestion;
  choice: string | null;
  openText: string;
  onChoiceChange: (id: string) => void;
  onOpenTextChange: (s: string) => void;
}

function QuestionBlock({
  q,
  choice,
  openText,
  onChoiceChange,
  onOpenTextChange,
}: QuestionBlockProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.qBlock}>
      <Mono size={9} style={styles.qStamp}>
        {t("retrospect.questionStamp", { dim: dimLabel(q.dim), no: q.no })}
      </Mono>
      <Display size={20} style={styles.qTitle}>
        {q.title}
      </Display>
      <View style={styles.options}>
        {q.options.map((o) => {
          const selected = choice === o.id;
          return (
            <TapEffect
              key={o.id}
              onPress={() => onChoiceChange(o.id)}
              style={[styles.option, selected && styles.optionSelected]}
              pressedStyle={{ backgroundColor: theme.color.paperPressed }}
            >
              <View style={[styles.dot, selected && styles.dotSelected]} />
              <Serif size={14} style={[styles.optionText, selected && styles.optionTextSelected]}>
                {o.label}
              </Serif>
            </TapEffect>
          );
        })}
      </View>
      {q.openPrompt ? (
        <View style={styles.openWrap}>
          <Serif size={12} italic style={styles.openPrompt}>
            {q.openPrompt}
          </Serif>
          <NativeField
            value={openText}
            onChangeText={onOpenTextChange}
            placeholder={t("retrospect.openPlaceholder")}
            multiline
            minHeight={96}
            bare
            containerStyle={styles.openBox}
            inputStyle={styles.openText}
          />
        </View>
      ) : null}
    </View>
  );
}

function ReadyToFinalize() {
  const { t } = useTranslation();
  return (
    <View style={styles.completedBlock}>
      <SectionHeader label={t("retrospect.ready.header")} meta={t("retrospect.ready.meta")} />
      <Serif size={14} italic style={styles.muted}>
        {t("retrospect.ready.body")}
      </Serif>
    </View>
  );
}

function Finalized({ retro }: { retro: NonNullable<ReturnType<typeof useRetrospect>["data"]> }) {
  const { t } = useTranslation();
  const dim = retro.focus_dim ?? "inference_depth";
  const text = retro.focus_text ?? t("retrospect.finalized.fallbackText");
  return (
    <View style={styles.completedBlock}>
      <Mono size={9} style={styles.qStamp}>
        {t("retrospect.finalized.stamp")}
      </Mono>
      <Display size={18} style={styles.focusTitle}>
        {focusDimLabel(dim)}
      </Display>
      <DoubleRule />
      <Serif size={15} style={styles.focusText}>
        {text}
      </Serif>
      <Serif size={12} italic style={styles.muted}>
        {t("retrospect.finalized.note")}
      </Serif>
    </View>
  );
}

function Footer({
  label,
  onPress,
  enabled,
}: {
  label: string;
  onPress: () => void;
  enabled: boolean;
}) {
  return (
    <View style={styles.footer}>
      <TapEffect
        style={[styles.primaryButton, !enabled && styles.buttonDim]}
        pressedStyle={enabled ? { backgroundColor: theme.color.ink2 } : undefined}
        onPress={enabled ? onPress : undefined}
        disabled={!enabled}
      >
        <Sans size={11} weight="700" style={styles.primaryLabel}>
          {label}
        </Sans>
      </TapEffect>
    </View>
  );
}

function dimLabel(d: string): string {
  switch (d) {
    case "perception":
      return i18nSingleton.t("retrospect.dim.perception");
    case "inference":
      return i18nSingleton.t("retrospect.dim.inference");
    case "evaluation":
      return i18nSingleton.t("retrospect.dim.evaluation");
    case "execution":
      return i18nSingleton.t("retrospect.dim.execution");
    default:
      return d.toUpperCase();
  }
}

function focusDimLabel(d: string): string {
  switch (d) {
    case "perception_speed":
      return i18nSingleton.t("retrospect.focusDim.perception_speed");
    case "inference_depth":
      return i18nSingleton.t("retrospect.focusDim.inference_depth");
    case "decision_speed":
      return i18nSingleton.t("retrospect.focusDim.decision_speed");
    case "holding_patience":
      return i18nSingleton.t("retrospect.focusDim.holding_patience");
    case "exit_quality":
      return i18nSingleton.t("retrospect.focusDim.exit_quality");
    case "thesis_evolution":
      return i18nSingleton.t("retrospect.focusDim.thesis_evolution");
    default:
      return d;
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  backButton: { flexDirection: "row", alignItems: "center", gap: 2, minWidth: 64 },
  headerStamp: {
    flex: 1,
    textAlign: "center",
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
  },
  headerSpacer: { minWidth: 64 },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  qBlock: { gap: theme.spacing.md },
  qStamp: { color: theme.color.muted, letterSpacing: 2, textTransform: "uppercase" },
  qTitle: { color: theme.color.ink, lineHeight: 28 },
  options: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    padding: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
  },
  optionSelected: {
    borderColor: theme.color.ink,
    borderWidth: 1,
    backgroundColor: theme.color.paper3,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.color.muted,
    marginTop: 6,
  },
  dotSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  optionText: { flex: 1, color: theme.color.ink2, lineHeight: 22 },
  optionTextSelected: { color: theme.color.ink },
  openWrap: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  openPrompt: { color: theme.color.muted },
  openBox: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    padding: theme.spacing.md,
  },
  openText: {
    fontFamily: "SourceSerif4-Regular",
    fontSize: 14,
    lineHeight: 22,
    color: theme.color.ink,
  },
  completedBlock: { gap: theme.spacing.md },
  focusTitle: { color: theme.color.ink, marginTop: theme.spacing.sm },
  focusText: { color: theme.color.ink2, lineHeight: 24 },
  muted: { color: theme.color.muted },
  error: { color: theme.color.red },
  footer: {
    padding: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
  },
  primaryButton: {
    backgroundColor: theme.color.ink,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  buttonDim: { backgroundColor: theme.color.muted2 },
  primaryLabel: { color: theme.color.paper, letterSpacing: 2, textTransform: "uppercase" },
});
