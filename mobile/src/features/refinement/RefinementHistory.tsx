/**
 * RefinementHistory — 五轮追问完成后, 在信号详情页底部回看全量问答.
 *
 * 默认**折叠**, 仅显示一行 header (♦ 五轮追问 · 档案 · meta · ↓).
 * 与 LearningCard 同一收缩交互, 两个底部块视觉对称, 不抢主体内容焦点.
 *
 * 展开后全量信息: 每一轮的问题 / 所有选项 (含未选 + distractor 标识) / 用户答案 /
 * 诊断 / 答题用时.
 *
 * 视觉延续 QuestionCard 的报刊风, 但所有交互态去掉 — 这里只是档案回看,
 * 不能点击, 不能修改. 选中的选项用 ink 边框, 其余 muted; distractor / user_input
 * 用 Mono 小标签区分.
 */

import { useState } from "react";
import { StyleSheet, View } from "react-native";
import { ChevronDown, ChevronUp } from "lucide-react-native";

import { Display, DoubleRule, Mono, RichText, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { formatLongDate } from "@/features/capture";
import type { Diagnosis, QuestionOption, RoundView, UserAnswer } from "@/core/api/refinement";

interface Props {
  rounds: RoundView[];
  decision?: string;
  completedAt?: string; // ISO; 没有就不显示
  /** 默认是否展开. 默认 false (折叠) — 与 LearningCard 一致, 不抢主体焦点. */
  defaultExpanded?: boolean;
}

export function RefinementHistory({
  rounds,
  decision,
  completedAt,
  defaultExpanded = false,
}: Props) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  if (rounds.length === 0) return null;
  const ordered = [...rounds].sort((a, b) => a.round - b.round);

  const headerMeta = buildHeaderMeta(rounds.length, decision);

  return (
    <View style={styles.root}>
      <TapEffect
        style={styles.header}
        pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={styles.diamond} />
        <Sans size={10} weight="700" style={styles.headerLabel}>
          五轮追问 · 档案
        </Sans>
        <Serif size={10} italic style={styles.headerMeta}>
          {headerMeta}
        </Serif>
        {expanded ? (
          <ChevronUp size={14} color={theme.color.muted} strokeWidth={1.5} />
        ) : (
          <ChevronDown size={14} color={theme.color.muted} strokeWidth={1.5} />
        )}
      </TapEffect>

      {expanded ? (
        <View style={styles.body}>
          <DoubleRule />
          {completedAt ? (
            <Mono size={10} style={styles.completedStamp}>
              完成于 {formatLongDate(completedAt)}
            </Mono>
          ) : null}
          <View style={styles.list}>
            {ordered.map((r) => (
              <RoundBlock key={r.round} round={r} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
}

function buildHeaderMeta(roundsLen: number, decision?: string): string {
  const decLabel = decisionLabel(decision);
  const parts = [`${roundsLen} 轮`];
  if (decLabel) parts.push(decLabel);
  return parts.join(" · ");
}

function RoundBlock({ round }: { round: RoundView }) {
  const userOpen = round.user_answer.open_text?.trim();
  const choiceIds = new Set(round.user_answer.choice_ids ?? []);
  const options = round.options ?? [];
  const isOrdering = round.question_kind === "ordering";
  const orderedChoices = round.user_answer.choice_ids ?? [];

  return (
    <View style={styles.round}>
      <View style={styles.roundHead}>
        <Mono size={9} style={styles.roundStamp}>
          ROUND {round.round} · {kindLabel(round.question_kind)}
        </Mono>
        <Mono size={9} style={styles.timeStamp}>
          {formatTime(round.user_answer.time_ms)}
        </Mono>
      </View>

      <Display size={17} italic style={styles.questionText}>
        <RichText text={round.question_text} />
      </Display>

      {options.length > 0 ? (
        <View style={styles.options}>
          {options.map((opt) => (
            <OptionRow
              key={opt.id}
              option={opt}
              selected={choiceIds.has(opt.id)}
              rank={isOrdering ? orderedChoices.indexOf(opt.id) : -1}
              userOpenText={opt.is_user_input ? userOpen : undefined}
            />
          ))}
        </View>
      ) : null}

      {/* 纯 open 题没有 options 列表, 用户答案直接在这里显示 */}
      {options.length === 0 && userOpen ? (
        <View style={styles.openAnswer}>
          <Mono size={9} style={styles.metaLabel}>
            你的回答
          </Mono>
          <Serif size={14} style={styles.openAnswerText}>
            {userOpen}
          </Serif>
        </View>
      ) : null}

      <DiagnosisRow diagnosis={round.diagnosis} answer={round.user_answer} />
    </View>
  );
}

interface OptionRowProps {
  option: QuestionOption;
  selected: boolean;
  rank: number; // -1 表示不是 ordering 或没排
  userOpenText?: string;
}

function OptionRow({ option, selected, rank, userOpenText }: OptionRowProps) {
  return (
    <View style={[styles.option, selected && styles.optionSelected]}>
      <View style={styles.optionMarker}>
        {rank >= 0 ? (
          <Mono size={11} style={[styles.rank, selected && styles.rankSelected]}>
            {rank + 1}
          </Mono>
        ) : (
          <View style={[styles.dot, selected && styles.dotSelected]} />
        )}
      </View>
      <View style={styles.optionBody}>
        <Serif
          size={13}
          italic={option.is_user_input}
          style={[styles.optionText, selected && styles.optionTextSelected]}
        >
          <RichText text={option.text} />
        </Serif>
        {option.is_user_input && selected && userOpenText ? (
          <Serif size={13} style={styles.userOpenText}>
            {userOpenText}
          </Serif>
        ) : null}
        <View style={styles.optionTags}>
          {option.is_distractor ? (
            <Mono size={9} style={[styles.tag, styles.tagDistractor]}>
              诱导
            </Mono>
          ) : null}
          {option.is_required ? (
            <Mono size={9} style={[styles.tag, styles.tagRequired]}>
              必选
            </Mono>
          ) : null}
          {option.is_user_input ? (
            <Mono size={9} style={[styles.tag, styles.tagUser]}>
              自填
            </Mono>
          ) : null}
        </View>
      </View>
    </View>
  );
}

function DiagnosisRow({ diagnosis, answer }: { diagnosis: Diagnosis; answer: UserAnswer }) {
  // 选项有 open_text 但 options 列表里的 is_user_input 已经把它带出来了 — 这里不重复.
  // 仅当 options 不存在的 open 题用上面的 openAnswer block.
  void answer;
  return (
    <View style={styles.diagnosis}>
      <Mono size={9} style={styles.metaLabel}>
        诊断
      </Mono>
      <View style={[styles.diagnosisBadge, diagnosisBadgeStyle(diagnosis.kind)]}>
        <Sans size={10} weight="600" style={styles.diagnosisLabel}>
          {diagnosisLabel(diagnosis.kind)}
        </Sans>
      </View>
      {diagnosis.note ? (
        <Serif size={12} italic style={styles.diagnosisNote}>
          {diagnosis.note}
        </Serif>
      ) : null}
    </View>
  );
}

// ───── helpers ─────

function kindLabel(k: RoundView["question_kind"]): string {
  switch (k) {
    case "single":
      return "推演 · 单选";
    case "multi":
      return "漏选 · 多选";
    case "ordering":
      return "排序";
    case "open":
      return "收尾 · 你自己写";
    case "commitment_setup":
      return "签字 · 承诺要素";
  }
}

function diagnosisLabel(k: Diagnosis["kind"]): string {
  switch (k) {
    case "correct":
      return "贴近";
    case "partial_miss":
      return "有漏";
    case "distractor":
      return "被带偏";
    case "weak":
      return "偏轻";
  }
}

function diagnosisBadgeStyle(k: Diagnosis["kind"]) {
  switch (k) {
    case "correct":
      return { backgroundColor: theme.color.paper3, borderColor: theme.color.green };
    case "partial_miss":
      return { backgroundColor: theme.color.paper3, borderColor: theme.color.muted };
    case "distractor":
      return { backgroundColor: theme.color.redSoft, borderColor: theme.color.red };
    case "weak":
      return { backgroundColor: theme.color.paper3, borderColor: theme.color.muted2 };
  }
}

function formatTime(ms: number): string {
  if (!ms || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

function decisionLabel(decision?: string): string | undefined {
  if (!decision) return undefined;
  if (decision === "training_only") return "训练";
  if (decision === "eligible_for_gate") return "进入四道门";
  return decision;
}

const styles = StyleSheet.create({
  root: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
    alignSelf: "center",
  },
  headerLabel: {
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.ink,
  },
  headerMeta: {
    marginLeft: "auto",
    color: theme.color.muted,
  },
  body: {
    gap: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
  },
  completedStamp: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  list: {
    gap: theme.spacing.lg,
    marginTop: theme.spacing.sm,
  },
  round: {
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  roundHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
  },
  roundStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  timeStamp: {
    color: theme.color.muted2,
    letterSpacing: 1,
  },
  questionText: {
    color: theme.color.ink,
    lineHeight: 24,
  },
  options: {
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
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
  optionMarker: {
    width: 18,
    alignItems: "center",
    paddingTop: 4,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    borderWidth: 1.5,
    borderColor: theme.color.muted2,
  },
  dotSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  rank: {
    color: theme.color.muted2,
  },
  rankSelected: {
    color: theme.color.ink,
    fontWeight: "600",
  },
  optionBody: {
    flex: 1,
    gap: 4,
  },
  optionText: {
    color: theme.color.ink3,
    lineHeight: 20,
  },
  optionTextSelected: {
    color: theme.color.ink,
  },
  userOpenText: {
    color: theme.color.ink2,
    paddingLeft: theme.spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    marginTop: 2,
  },
  optionTags: {
    flexDirection: "row",
    gap: theme.spacing.xs,
    marginTop: 2,
  },
  tag: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    borderWidth: StyleSheet.hairlineWidth,
  },
  tagDistractor: {
    color: theme.color.red,
    borderColor: theme.color.red,
  },
  tagRequired: {
    color: theme.color.ink2,
    borderColor: theme.color.ink2,
  },
  tagUser: {
    color: theme.color.muted,
    borderColor: theme.color.muted,
  },
  openAnswer: {
    gap: theme.spacing.xs,
    marginTop: theme.spacing.xs,
    paddingLeft: theme.spacing.sm,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
  },
  openAnswerText: {
    color: theme.color.ink,
    lineHeight: 22,
  },
  metaLabel: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  diagnosis: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    flexWrap: "wrap",
  },
  diagnosisBadge: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  diagnosisLabel: {
    color: theme.color.ink2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  diagnosisNote: {
    color: theme.color.muted,
    flex: 1,
  },
});
