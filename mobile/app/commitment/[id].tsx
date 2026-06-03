/**
 * 承诺书阅读 + 签字 (M7 + M8).
 *
 * 阅读态 (status=drafted/postponed):
 *   - 完整 thesis 展示: ticker / action / position_pct / duration / entry_method
 *   - 退出条件 (罗马数字列表)
 *   - 给未来自己的理由 (3-5 段 Serif italic)
 *   - 底部两按钮: "签字, 提交承诺" (黑底白字) + "先放着" (Outline)
 *
 * 签字态 (status=signed):
 *   - 同样内容, 但 footer 显示"持仓中 · 第 N 天 — 见档案"
 *
 * 严格反模式:
 *   - 签字成功 NO toast, NO loading spinner, NO "成功!"
 *   - 按下按钮: TapEffect 默认 pressedStyle, 200 内若没返回再显示"仍在签收中..." (打字机)
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";

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
import { theme } from "@/core/theme";
import { formatIsoDate } from "@/shared/format";

import { useCommitment, usePostponeCommitment, useSignCommitment } from "@/features/commitment";
import { TypewriterText } from "@/features/refinement";
import { useRecordOpen, type CompanionView } from "@/features/companion";
import { ProjectBadge } from "@/features/project/ProjectBadge";

type FinalDecisionChoice = "as_drafted" | "lower_position" | "longer_hold" | "user_input";

export default function CommitmentScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { data: commit, isLoading, isError } = useCommitment(id);
  const { sign, isSigning } = useSignCommitment();
  const { postpone, isPostponing } = usePostponeCommitment();
  const { open } = useRecordOpen();
  const [showSlowSign, setShowSlowSign] = useState(false);
  const [companion, setCompanion] = useState<CompanionView | null>(null);
  const [decisionChoice, setDecisionChoice] = useState<FinalDecisionChoice>("as_drafted");
  const [decisionNote, setDecisionNote] = useState("");
  const recordedOpenRef = useRef(false);

  // 进入 signed commitment 页一次性 POST /open. 不在 drafted 状态触发,
  // 因为 drafted 状态下用户没有"持仓焦虑"概念.
  useEffect(() => {
    if (!commit || commit.status !== "signed") return;
    if (recordedOpenRef.current) return;
    recordedOpenRef.current = true;
    open({ commitment_id: commit.id, origin: "tab" })
      .then((res) => {
        if (res.should_show_companion && res.companion) {
          setCompanion(res.companion);
        }
      })
      .catch((err) => console.warn("[open] failed:", err));
  }, [commit, open]);

  const handleSign = async () => {
    if (!commit) return;
    // 用户在签字前选择的最终判断 — 当前 v1 只在客户端记录,
    // 后端 sign 仍按 narrator 草稿落库. M7.5 计划把 decision_note 推到 events 表里.
    const finalChoice = describeFinalChoice(decisionChoice, decisionNote);
    if (finalChoice) {
      console.log("[sign] final decision:", finalChoice);
    }
    // 200ms 内若还没回, 才显示"仍在签收中..." (打字机)
    const slowTimer = setTimeout(() => setShowSlowSign(true), 200);
    try {
      await sign(commit.id);
      router.replace("/(tabs)/inbox");
    } catch (err) {
      console.warn("[sign] failed:", err);
    } finally {
      clearTimeout(slowTimer);
      setShowSlowSign(false);
    }
  };

  const canSign = useMemo(() => {
    if (isSigning || isPostponing) return false;
    if (decisionChoice === "user_input" && decisionNote.trim().length < 10) return false;
    return true;
  }, [decisionChoice, decisionNote, isSigning, isPostponing]);

  const handlePostpone = async () => {
    if (!commit) return;
    try {
      await postpone({ commitmentId: commit.id });
      router.back();
    } catch (err) {
      console.warn("[postpone] failed:", err);
    }
  };

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header />
      <ScrollView contentContainerStyle={styles.scroll}>
        {companion ? <CompanionCard view={companion} /> : null}
        {isLoading ? (
          <Serif size={13} italic style={styles.muted}>
            正在打开承诺书...
          </Serif>
        ) : isError || !commit ? (
          <Serif size={13} italic style={styles.error}>
            打不开这份承诺书, 稍后再试.
          </Serif>
        ) : (
          <Body commitment={commit} />
        )}
      </ScrollView>
      {commit && commit.status !== "signed" && commit.status !== "abandoned" ? (
        <View style={styles.footer}>
          <FinalDecision
            thesis={commit.thesis}
            choice={decisionChoice}
            note={decisionNote}
            onChoice={setDecisionChoice}
            onNote={setDecisionNote}
          />
          {showSlowSign ? (
            <TypewriterText text="仍在签收中..." style={styles.slowText} italic />
          ) : null}
          <TapEffect
            style={[styles.primaryButton, !canSign && styles.buttonDim]}
            pressedStyle={canSign ? { backgroundColor: theme.color.ink2 } : undefined}
            onPress={canSign ? handleSign : undefined}
            disabled={!canSign}
          >
            <Sans size={11} weight="700" style={styles.primaryLabel}>
              {isSigning ? "正在签字..." : signButtonLabel(decisionChoice)}
            </Sans>
          </TapEffect>
          <TapEffect
            style={styles.secondaryButton}
            onPress={handlePostpone}
            disabled={isSigning || isPostponing}
          >
            <Serif size={13} italic style={styles.secondaryLabel}>
              先放着
            </Serif>
          </TapEffect>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

interface FinalDecisionProps {
  thesis: { position_pct: number; duration_months: number; action: string };
  choice: FinalDecisionChoice;
  note: string;
  onChoice: (c: FinalDecisionChoice) => void;
  onNote: (s: string) => void;
}

/**
 * 签字前最后一次"自己选". 不是分析师的判断, 是你的判断.
 *
 * 4 个选项:
 *   - as_drafted: 按 AI 草稿签 (默认)
 *   - lower_position: 调小一档仓位 (减 2 个百分点, 下限 1%)
 *   - longer_hold: 拉长一档持仓 (加 6 个月, 上限 36)
 *   - user_input: 用自己的话写一条决策注脚
 *
 * v1 客户端记录, 不修改 thesis 落库. M7.5 把 decision_note 推到 events.
 */
function FinalDecision({ thesis, choice, note, onChoice, onNote }: FinalDecisionProps) {
  const lowerPct = Math.max(1, Math.round(thesis.position_pct - 2));
  const longerMonths = Math.min(36, thesis.duration_months + 6);
  const opts: { id: FinalDecisionChoice; label: string; hint: string }[] = [
    {
      id: "as_drafted",
      label: "就照这份草稿签",
      hint: `${actionLabel(thesis.action)} · ${thesis.position_pct.toFixed(0)}% · ${thesis.duration_months} 个月`,
    },
    {
      id: "lower_position",
      label: "更保守 — 调小仓位",
      hint: `仓位降到 ${lowerPct}% (其余不变)`,
    },
    {
      id: "longer_hold",
      label: "更耐心 — 拉长持仓",
      hint: `持仓拉到 ${longerMonths} 个月`,
    },
    {
      id: "user_input",
      label: "我有不一样的判断 — 写下来",
      hint: "你自己的语言, 不少于 10 字",
    },
  ];
  return (
    <View style={decisionStyles.root}>
      <Mono size={9} style={decisionStyles.stamp}>
        DECISION · 你的最终判断
      </Mono>
      <View style={decisionStyles.options}>
        {opts.map((o) => {
          const selected = choice === o.id;
          return (
            <TapEffect
              key={o.id}
              style={[decisionStyles.option, selected && decisionStyles.optionSelected]}
              pressedStyle={{ backgroundColor: theme.color.paperPressed }}
              onPress={() => onChoice(o.id)}
            >
              <View style={[decisionStyles.dot, selected && decisionStyles.dotSelected]} />
              <View style={decisionStyles.optionText}>
                <Serif size={14} italic={o.id === "user_input"} style={decisionStyles.optionLabel}>
                  {o.label}
                </Serif>
                <Mono size={10} style={decisionStyles.optionHint}>
                  {o.hint}
                </Mono>
              </View>
            </TapEffect>
          );
        })}
      </View>
      {choice === "user_input" ? (
        <TextInput
          value={note}
          onChangeText={onNote}
          placeholder="例: 我接受买入但只用 3%, 因为这条信号还没穿过供应链层"
          placeholderTextColor={theme.color.muted2}
          multiline
          style={decisionStyles.noteInput}
        />
      ) : null}
    </View>
  );
}

function describeFinalChoice(choice: FinalDecisionChoice, note: string): string | null {
  switch (choice) {
    case "as_drafted":
      return null;
    case "lower_position":
      return "lower_position";
    case "longer_hold":
      return "longer_hold";
    case "user_input":
      return `user_input:${note.trim()}`;
  }
}

function signButtonLabel(choice: FinalDecisionChoice): string {
  switch (choice) {
    case "lower_position":
      return "按更保守的判断签字";
    case "longer_hold":
      return "按更耐心的判断签字";
    case "user_input":
      return "按我的判断签字";
    default:
      return "签字, 提交承诺";
  }
}

function Body({ commitment }: { commitment: ReturnType<typeof useCommitment>["data"] }) {
  if (!commitment) return null;
  const t = commitment.thesis;
  const signed = commitment.status === "signed";
  const postponed = commitment.status === "postponed";

  return (
    <View style={styles.body}>
      <Mono size={9} style={styles.stamp}>
        {signed
          ? `已签字 · ${formatIsoDate(commitment.signed_at ?? "")}`
          : postponed
            ? `已放置 · ${commitment.postpone_count}/3`
            : "草稿 · 等你签字"}
      </Mono>

      <ProjectBadge projectId={commitment.project_id} />

      <Display size={26} style={styles.headline}>
        {t.asset_name}
        <Display size={26} italic>
          {" "}
          ({t.asset_ticker})
        </Display>
      </Display>
      <Mono size={11} style={styles.meta}>
        {actionLabel(t.action)} · {t.position_pct.toFixed(0)}% 仓位 · {t.duration_months} 个月
      </Mono>

      <DoubleRule />

      <SectionHeader label="进入" meta="ENTRY" />
      <Serif size={15} style={styles.entry}>
        {t.entry_method}
      </Serif>

      <SectionHeader label="退出条件" meta="EXIT" />
      <View style={styles.list}>
        {t.exit_conditions.map((c, i) => (
          <View key={i} style={styles.listItem}>
            <Mono size={11} style={styles.listMarker}>
              {roman(i + 1)}.
            </Mono>
            <Serif size={14} style={styles.listText}>
              {c}
            </Serif>
          </View>
        ))}
      </View>

      <SectionHeader label="给未来的你" meta="REASONS" />
      <View style={styles.reasons}>
        {t.reasons_for_future_self.map((r, i) => (
          <View key={i} style={styles.reasonItem}>
            <Mono size={10} style={styles.reasonMarker}>
              § {i + 1}
            </Mono>
            <Serif size={14} italic style={styles.reasonText}>
              {r}
            </Serif>
          </View>
        ))}
      </View>

      {signed ? (
        <View style={styles.signedBanner}>
          <DoubleRule />
          <SectionHeader
            label="持仓中"
            meta={`签字日 ${formatIsoDate(commitment.signed_at ?? "")}`}
          />
          <Serif size={13} italic style={styles.muted}>
            这份承诺已经归档. 退出条件已经被复制到持仓状态机, 它会安静地巡检. 你不用做什么.
          </Serif>
        </View>
      ) : null}
    </View>
  );
}

function CompanionCard({ view }: { view: CompanionView }) {
  // E4 焦虑日卡: 引用用户自己签字时写的一段话 (editor_text 来自 reasons_for_future_self).
  // 不预测涨跌, 不安抚, 不分析市场. 它就是把当时的判断换种语气递回来.
  return (
    <View style={cardStyles.root}>
      <View style={cardStyles.rule} />
      <Mono size={9} style={cardStyles.stamp}>
        {view.reason === "anxiety_5x" ? "E4 · 焦虑日 · 第 5 次" : "E4 · 焦虑日"}
      </Mono>
      <Serif size={14} italic style={cardStyles.intro}>
        你今天已经打开了好几次. 你当时写下了这句:
      </Serif>
      <Serif size={16} style={cardStyles.body}>
        「{view.editor_text}」
      </Serif>
      <Serif size={13} italic style={cardStyles.outro}>
        没有任何退出条件被触发. 这是规则.
      </Serif>
      <View style={cardStyles.rule} />
    </View>
  );
}

function Header() {
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>返回</Serif>
      </TapEffect>
      <Sans size={9} weight="600" style={styles.headerStamp}>
        VOL. I · 承诺书
      </Sans>
      <View style={styles.headerSpacer} />
    </View>
  );
}

function actionLabel(a: string): string {
  switch (a) {
    case "buy":
      return "买入";
    case "sell":
      return "卖出";
    case "hold":
      return "持有";
    default:
      return a;
  }
}

function roman(n: number): string {
  const r = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X"];
  return r[n - 1] ?? String(n);
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
  body: { gap: theme.spacing.md },
  stamp: { color: theme.color.muted, letterSpacing: 2, textTransform: "uppercase" },
  headline: { color: theme.color.ink, lineHeight: 34 },
  meta: { color: theme.color.muted, letterSpacing: 1 },
  entry: { color: theme.color.ink2, lineHeight: 24 },
  list: { gap: theme.spacing.sm, marginTop: theme.spacing.sm },
  listItem: { flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" },
  listMarker: { color: theme.color.muted, paddingTop: 4, width: 32 },
  listText: { flex: 1, color: theme.color.ink, lineHeight: 22 },
  reasons: { gap: theme.spacing.md, marginTop: theme.spacing.sm },
  reasonItem: { gap: 4 },
  reasonMarker: { color: theme.color.muted, letterSpacing: 1 },
  reasonText: { color: theme.color.ink2, lineHeight: 23 },
  signedBanner: { marginTop: theme.spacing.lg, gap: theme.spacing.sm },
  footer: {
    padding: theme.spacing.lg,
    gap: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
  },
  slowText: {
    color: theme.color.muted,
    textAlign: "center",
    paddingBottom: theme.spacing.sm,
  },
  primaryButton: {
    backgroundColor: theme.color.ink,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  buttonDim: { backgroundColor: theme.color.muted2 },
  primaryLabel: { color: theme.color.paper, letterSpacing: 2, textTransform: "uppercase" },
  secondaryButton: {
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  secondaryLabel: { color: theme.color.muted },
  muted: { color: theme.color.muted },
  error: { color: theme.color.red },
});

const decisionStyles = StyleSheet.create({
  root: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
    marginBottom: theme.spacing.sm,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  options: {
    gap: theme.spacing.xs,
  },
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    gap: theme.spacing.sm,
  },
  optionSelected: {
    borderColor: theme.color.ink,
    borderWidth: 1,
    backgroundColor: theme.color.paper3,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.color.muted,
    marginTop: 5,
  },
  dotSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  optionText: {
    flex: 1,
    gap: 2,
  },
  optionLabel: {
    color: theme.color.ink,
    lineHeight: 20,
  },
  optionHint: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
  noteInput: {
    minHeight: 80,
    fontFamily: "SourceSerif4-Regular",
    fontSize: 14,
    lineHeight: 22,
    color: theme.color.ink,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    backgroundColor: theme.color.paper3,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    textAlignVertical: "top",
  },
});

const cardStyles = StyleSheet.create({
  root: {
    backgroundColor: theme.color.paper2,
    paddingVertical: theme.spacing.md,
    marginBottom: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  rule: {
    height: 1,
    backgroundColor: theme.color.ink,
    marginVertical: theme.spacing.xs,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  intro: {
    color: theme.color.muted,
  },
  body: {
    color: theme.color.ink,
    lineHeight: 24,
    paddingVertical: theme.spacing.sm,
  },
  outro: {
    color: theme.color.muted,
  },
});
