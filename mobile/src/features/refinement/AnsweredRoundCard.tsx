/**
 * AnsweredRoundCard — 已答轮次的只读展示.
 *
 * 同 QuestionCard 的视觉骨架: roundStamp + Display 题目 + separator + 选项列表.
 * 区别:
 *   - 不接收 onAnswerChange, 不交互 (TapEffect 用 disableEffect, onPress 空)
 *   - 用户选过的选项: ink 边框 + paper3 背景 + 实心 marker (同 QuestionCard 的 selected)
 *   - 没选的选项: 保留可读但灰化 (muted color), marker 空心
 *   - open 题型: 直接展示 user_answer.open_text 作为 Serif 段落, 不是 TextInput
 *   - commitment_setup: 两个选项组 + 一段只读 open_text
 *
 * 这个 read-only card 在新版 RefinementScreen 里垂直排列, 让用户答完往下滚就能
 * 回头看之前几轮.
 */

import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";
import { Display, Mono, RichText, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import type { QuestionOption, RoundView } from "@/core/api/refinement";

import { optionStyles } from "./optionStyles";

interface Props {
  round: RoundView;
}

export function AnsweredRoundCard({ round }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.root}>
      <Mono size={9} style={styles.roundStamp}>
        ROUND {round.round} · {kindLabel(round.question_kind, t)} · {t("refinement.answered.stampSuffix")}
      </Mono>
      <Display size={20} style={styles.questionText}>
        <RichText text={round.question_text} />
      </Display>
      <View style={styles.separator} />
      <Body round={round} />
    </View>
  );
}

function Body({ round }: Props) {
  const { t } = useTranslation();
  const { question_kind, options, user_answer } = round;
  const chosen = new Set(user_answer.choice_ids ?? []);

  if (question_kind === "open") {
    return (
      <View style={styles.openWrap}>
        {user_answer.open_text ? (
          <Serif size={14} style={styles.openTextAnswer}>
            {user_answer.open_text}
          </Serif>
        ) : (
          <Serif size={13} italic style={styles.openEmpty}>
            {t("refinement.answered.empty")}
          </Serif>
        )}
      </View>
    );
  }

  if (question_kind === "commitment_setup") {
    const actionOpts = (options ?? []).filter((o) => o.group === "action");
    const durationOpts = (options ?? []).filter((o) => o.group === "duration");
    return (
      <View style={styles.commitWrap}>
        <Mono size={9} style={styles.groupLabel}>
          {t("refinement.answered.groupAction")}
        </Mono>
        <OptionList opts={actionOpts} chosen={chosen} marker="dot" />
        <Mono size={9} style={[styles.groupLabel, styles.groupLabelSpaced]}>
          {t("refinement.answered.groupDuration")}
        </Mono>
        <OptionList opts={durationOpts} chosen={chosen} marker="dot" />
        <Mono size={9} style={[styles.groupLabel, styles.groupLabelSpaced]}>
          {t("refinement.answered.groupReason")}
        </Mono>
        {user_answer.open_text ? (
          <Serif size={14} style={styles.openTextAnswer}>
            {user_answer.open_text}
          </Serif>
        ) : (
          <Serif size={13} italic style={styles.openEmpty}>
            {t("refinement.answered.empty")}
          </Serif>
        )}
      </View>
    );
  }

  // single / multi / ordering 共用 OptionList; ordering 多 rank 标
  const marker: MarkerKind =
    question_kind === "multi" ? "square" : question_kind === "ordering" ? "rank" : "dot";
  const orderList = question_kind === "ordering" ? (user_answer.choice_ids ?? []) : undefined;

  return (
    <View style={styles.options}>
      <OptionList opts={options ?? []} chosen={chosen} marker={marker} orderList={orderList} />
      {user_answer.open_text ? (
        <View style={styles.userInputBlock}>
          <Mono size={9} style={styles.groupLabel}>
            {t("refinement.answered.youWrote")}
          </Mono>
          <Serif size={13} style={styles.userInputText}>
            {user_answer.open_text}
          </Serif>
        </View>
      ) : null}
    </View>
  );
}

type MarkerKind = "dot" | "square" | "rank";

function OptionList({
  opts,
  chosen,
  marker,
  orderList,
}: {
  opts: QuestionOption[];
  chosen: Set<string>;
  marker: MarkerKind;
  orderList?: string[];
}) {
  return (
    <View style={styles.options}>
      {opts.map((o, i) => {
        const isSelected = chosen.has(o.id);
        const rank = orderList ? orderList.indexOf(o.id) : -1;
        return (
          <View key={o.id} style={[optionStyles.option, isSelected && optionStyles.optionSelected]}>
            <View style={optionStyles.optionMarker}>
              {marker === "dot" ? (
                <View style={[optionStyles.dot, isSelected && optionStyles.dotSelected]} />
              ) : marker === "square" ? (
                <View style={[optionStyles.square, isSelected && optionStyles.squareSelected]} />
              ) : (
                <Mono
                  size={11}
                  style={[optionStyles.rank, isSelected && optionStyles.rankSelected]}
                >
                  {rank >= 0 ? rank + 1 : indexLabel(i)}
                </Mono>
              )}
            </View>
            <Serif
              size={14}
              italic={!!o.is_user_input}
              style={[
                styles.optionText,
                isSelected ? optionStyles.optionTextSelected : styles.optionTextDim,
              ]}
            >
              <RichText text={o.text} />
            </Serif>
          </View>
        );
      })}
    </View>
  );
}

function kindLabel(k: RoundView["question_kind"], t: TFunction): string {
  switch (k) {
    case "single":
      return t("refinement.kind.single");
    case "multi":
      return t("refinement.kind.multi");
    case "ordering":
      return t("refinement.kind.ordering");
    case "open":
      return t("refinement.kind.open");
    case "commitment_setup":
      return t("refinement.kind.commitmentSetup");
  }
}

function indexLabel(i: number): string {
  return String.fromCharCode("a".charCodeAt(0) + i);
}

const styles = StyleSheet.create({
  root: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  roundStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  questionText: {
    color: theme.color.ink,
    lineHeight: 30,
  },
  separator: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ruleSoft,
    marginVertical: theme.spacing.sm,
  },
  options: {
    gap: theme.spacing.sm,
  },
  optionText: {
    flex: 1,
    lineHeight: 22,
  },
  optionTextDim: {
    color: theme.color.muted2,
  },
  openWrap: {
    gap: theme.spacing.sm,
  },
  openTextAnswer: {
    color: theme.color.ink,
    lineHeight: 22,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    backgroundColor: theme.color.paper2,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  openEmpty: {
    color: theme.color.muted2,
  },
  userInputBlock: {
    marginTop: theme.spacing.xs,
    gap: theme.spacing.xs,
  },
  userInputText: {
    color: theme.color.ink2,
    lineHeight: 22,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    backgroundColor: theme.color.paper3,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  commitWrap: {
    gap: theme.spacing.sm,
  },
  groupLabel: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  groupLabelSpaced: {
    paddingTop: theme.spacing.md,
  },
});
