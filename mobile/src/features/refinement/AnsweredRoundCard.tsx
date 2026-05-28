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
import { Display, Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import type { QuestionOption, RoundView } from "@/core/api/refinement";

interface Props {
  round: RoundView;
}

export function AnsweredRoundCard({ round }: Props) {
  return (
    <View style={styles.root}>
      <Mono size={9} style={styles.roundStamp}>
        ROUND {round.round} · {kindLabel(round.question_kind)} · 已答
      </Mono>
      <Display size={20} style={styles.questionText}>
        {round.question_text}
      </Display>
      <View style={styles.separator} />
      <Body round={round} />
    </View>
  );
}

function Body({ round }: Props) {
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
            (留空)
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
          A · 操作
        </Mono>
        <OptionList opts={actionOpts} chosen={chosen} marker="dot" />
        <Mono size={9} style={[styles.groupLabel, styles.groupLabelSpaced]}>
          B · 持仓时长
        </Mono>
        <OptionList opts={durationOpts} chosen={chosen} marker="dot" />
        <Mono size={9} style={[styles.groupLabel, styles.groupLabelSpaced]}>
          C · 你的理由 + 退出条件
        </Mono>
        {user_answer.open_text ? (
          <Serif size={14} style={styles.openTextAnswer}>
            {user_answer.open_text}
          </Serif>
        ) : (
          <Serif size={13} italic style={styles.openEmpty}>
            (留空)
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
            你写的:
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
          <View key={o.id} style={[styles.option, isSelected && styles.optionSelected]}>
            <View style={styles.optionMarker}>
              {marker === "dot" ? (
                <View style={[styles.dot, isSelected && styles.dotSelected]} />
              ) : marker === "square" ? (
                <View style={[styles.square, isSelected && styles.squareSelected]} />
              ) : (
                <Mono size={11} style={[styles.rank, isSelected && styles.rankSelected]}>
                  {rank >= 0 ? rank + 1 : indexLabel(i)}
                </Mono>
              )}
            </View>
            <Serif
              size={14}
              italic={!!o.is_user_input}
              style={[
                styles.optionText,
                isSelected ? styles.optionTextSelected : styles.optionTextDim,
              ]}
            >
              {o.text}
            </Serif>
          </View>
        );
      })}
    </View>
  );
}

function kindLabel(k: RoundView["question_kind"]): string {
  switch (k) {
    case "single":
      return "推演 · 单选";
    case "multi":
      return "漏选 · 多选";
    case "ordering":
      return "排序 · 哪个先发生";
    case "open":
      return "收尾 · 你自己写";
    case "commitment_setup":
      return "签字 · 承诺要素";
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
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    gap: theme.spacing.md,
  },
  optionSelected: {
    borderColor: theme.color.ink,
    borderWidth: 1,
    backgroundColor: theme.color.paper3,
  },
  optionMarker: {
    width: 24,
    alignItems: "center",
    paddingTop: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.color.muted,
  },
  dotSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  square: {
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderColor: theme.color.muted,
  },
  squareSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  rank: {
    color: theme.color.muted,
  },
  rankSelected: {
    color: theme.color.ink,
    fontWeight: "600",
  },
  optionText: {
    flex: 1,
    lineHeight: 22,
  },
  optionTextSelected: {
    color: theme.color.ink,
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
