/**
 * QuestionCard — 一道追问题. 4 种题型走同一组件, 内部分支渲染.
 *
 * 视觉: 报刊感. 题目正文用 Display italic + Serif body. 选项是带边框的 PaperCard,
 * 选中态用 ink 边框 + paper3 背景. Ordering 用编号 1/2/3 表示顺序.
 *
 * 行为:
 *   - single: 点选一项 → answer.choice_ids = [id]
 *   - multi: 反复点击 toggle 在 choice_ids 里
 *   - ordering: 点击按顺序追加, 再次点击移出 (清空当前编号)
 *   - open: TextInput 多行, 用户写文字
 *
 * Submit 是父组件管 — 这里只负责"当前答案"的状态.
 */

import { useCallback, useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";
import { Display, Mono, RichText, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type {
  PendingQuestionPayload,
  QuestionKindT,
  QuestionOption,
  UserAnswer,
} from "@/core/api/refinement";

import { InputTrigger } from "./InputTrigger";
import { TextInputModal } from "./TextInputModal";
import { optionStyles } from "./optionStyles";

interface Props {
  question: PendingQuestionPayload;
  onAnswerChange: (answer: UserAnswer) => void;
}

export function QuestionCard(props: Props) {
  const { question } = props;
  return (
    <View style={styles.root}>
      <Mono size={9} style={styles.roundStamp}>
        ROUND {question.round} · {kindLabel(question.kind)}
      </Mono>
      <Display size={20} style={styles.questionText}>
        <RichText text={question.text} />
      </Display>
      <View style={styles.separator} />
      <Body {...props} />
    </View>
  );
}

function Body(props: Props) {
  switch (props.question.kind) {
    case "single":
      return <SingleChoice {...props} />;
    case "multi":
      return <MultiChoice {...props} />;
    case "ordering":
      return <Ordering {...props} />;
    case "open":
      return <OpenText {...props} />;
    case "commitment_setup":
      return <CommitmentSetup {...props} />;
  }
}

// ───── single ─────

function SingleChoice({ question, onAnswerChange }: Props) {
  const [selected, setSelected] = useState<string | null>(null);
  const [userText, setUserText] = useState("");
  const start = useMemo(() => Date.now(), []);

  const pick = useCallback(
    (id: string, isUserInput: boolean) => {
      setSelected(id);
      onAnswerChange({
        choice_ids: [id],
        open_text: isUserInput ? userText : undefined,
        time_ms: Date.now() - start,
      });
    },
    [onAnswerChange, start, userText],
  );

  const changeUserText = useCallback(
    (s: string) => {
      setUserText(s);
      // 写文本即视作选中那条 user_input
      const userOpt = question.options?.find((o) => o.is_user_input);
      if (userOpt) {
        setSelected(userOpt.id);
        onAnswerChange({
          choice_ids: [userOpt.id],
          open_text: s,
          time_ms: Date.now() - start,
        });
      }
    },
    [onAnswerChange, question.options, start],
  );

  const options = question.options ?? [];
  return (
    <View style={styles.options}>
      {options.map((o, i) => (
        <OptionRow
          key={o.id}
          option={o}
          index={i}
          selected={selected === o.id}
          marker="dot"
          onPress={() => pick(o.id, !!o.is_user_input)}
          userText={userText}
          onUserTextChange={changeUserText}
        />
      ))}
    </View>
  );
}

// ───── multi ─────

function MultiChoice({ question, onAnswerChange }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [userText, setUserText] = useState("");
  const start = useMemo(() => Date.now(), []);

  const userOpt = useMemo(() => question.options?.find((o) => o.is_user_input), [question.options]);

  const pushAnswer = useCallback(
    (nextSet: Set<string>, nextText: string) => {
      const includeText = userOpt && nextSet.has(userOpt.id);
      onAnswerChange({
        choice_ids: Array.from(nextSet),
        open_text: includeText ? nextText : undefined,
        time_ms: Date.now() - start,
      });
    },
    [onAnswerChange, start, userOpt],
  );

  const toggle = useCallback(
    (id: string) => {
      setSelected((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        pushAnswer(next, userText);
        return next;
      });
    },
    [pushAnswer, userText],
  );

  const changeUserText = useCallback(
    (s: string) => {
      setUserText(s);
      if (!userOpt) return;
      setSelected((prev) => {
        const next = new Set(prev);
        next.add(userOpt.id);
        pushAnswer(next, s);
        return next;
      });
    },
    [pushAnswer, userOpt],
  );

  const options = question.options ?? [];
  return (
    <View style={styles.options}>
      {options.map((o, i) => (
        <OptionRow
          key={o.id}
          option={o}
          index={i}
          selected={selected.has(o.id)}
          marker="square"
          onPress={() => toggle(o.id)}
          userText={userText}
          onUserTextChange={changeUserText}
        />
      ))}
    </View>
  );
}

// ───── ordering ─────

function Ordering({ question, onAnswerChange }: Props) {
  const [order, setOrder] = useState<string[]>([]);
  const [userText, setUserText] = useState("");
  const start = useMemo(() => Date.now(), []);

  const userOpt = useMemo(() => question.options?.find((o) => o.is_user_input), [question.options]);

  const pushAnswer = useCallback(
    (nextOrder: string[], nextText: string) => {
      const includeText = userOpt && nextOrder.includes(userOpt.id);
      onAnswerChange({
        choice_ids: nextOrder,
        open_text: includeText ? nextText : undefined,
        time_ms: Date.now() - start,
      });
    },
    [onAnswerChange, start, userOpt],
  );

  const toggle = useCallback(
    (id: string) => {
      setOrder((prev) => {
        const idx = prev.indexOf(id);
        const next = idx === -1 ? [...prev, id] : prev.filter((x) => x !== id);
        pushAnswer(next, userText);
        return next;
      });
    },
    [pushAnswer, userText],
  );

  const changeUserText = useCallback(
    (s: string) => {
      setUserText(s);
      if (!userOpt) return;
      setOrder((prev) => {
        const next = prev.includes(userOpt.id) ? prev : [...prev, userOpt.id];
        pushAnswer(next, s);
        return next;
      });
    },
    [pushAnswer, userOpt],
  );

  const options = question.options ?? [];
  return (
    <View style={styles.options}>
      {options.map((o, i) => {
        const rank = order.indexOf(o.id);
        return (
          <OptionRow
            key={o.id}
            option={o}
            index={i}
            selected={rank !== -1}
            marker="rank"
            rank={rank === -1 ? undefined : rank + 1}
            onPress={() => toggle(o.id)}
            userText={userText}
            onUserTextChange={changeUserText}
          />
        );
      })}
    </View>
  );
}

// ───── open ─────

function OpenText({ question, onAnswerChange }: Props) {
  const [text, setText] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const start = useMemo(() => Date.now(), []);

  const change = useCallback(
    (s: string) => {
      setText(s);
      onAnswerChange({ open_text: s, time_ms: Date.now() - start });
    },
    [onAnswerChange, start],
  );

  return (
    <View style={styles.openWrap}>
      {(question.open_prompts ?? []).map((p, i) => (
        <Serif key={i} size={13} italic style={styles.openPrompt}>
          <RichText text={p} />
        </Serif>
      ))}
      <InputTrigger
        value={text}
        placeholder="一句话写下你的回答"
        onPress={() => setModalOpen(true)}
      />
      <TextInputModal
        visible={modalOpen}
        title={question.text.length > 60 ? question.text.slice(0, 60) + "…" : question.text}
        placeholder="一句话写下你的回答"
        value={text}
        hints={question.open_prompts}
        onSave={(t) => {
          change(t);
          setModalOpen(false);
        }}
        onCancel={() => setModalOpen(false)}
      />
    </View>
  );
}

// ───── commitment_setup (r5) ─────
// 两组单选 (action + duration) + 一段开放文本 (理由 + 退出条件).
// choice_ids = [action_id, duration_id] (顺序无关), open_text = textarea 内容.
// 三块全部填齐才算"答完", 父组件按 onAnswerChange 推送当前状态.

function CommitmentSetup({ question, onAnswerChange }: Props) {
  const [actionId, setActionId] = useState<string | null>(null);
  const [durationId, setDurationId] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [modalOpen, setModalOpen] = useState(false);
  const start = useMemo(() => Date.now(), []);

  const actionOpts = useMemo(
    () => (question.options ?? []).filter((o) => o.group === "action"),
    [question.options],
  );
  const durationOpts = useMemo(
    () => (question.options ?? []).filter((o) => o.group === "duration"),
    [question.options],
  );

  const push = useCallback(
    (a: string | null, d: string | null, t: string) => {
      const ids = [a, d].filter((x): x is string => !!x);
      onAnswerChange({
        choice_ids: ids.length > 0 ? ids : undefined,
        open_text: t.length > 0 ? t : undefined,
        time_ms: Date.now() - start,
      });
    },
    [onAnswerChange, start],
  );

  const pickAction = useCallback(
    (id: string) => {
      setActionId(id);
      push(id, durationId, text);
    },
    [push, durationId, text],
  );

  const pickDuration = useCallback(
    (id: string) => {
      setDurationId(id);
      push(actionId, id, text);
    },
    [push, actionId, text],
  );

  const changeText = useCallback(
    (s: string) => {
      setText(s);
      push(actionId, durationId, s);
    },
    [push, actionId, durationId],
  );

  return (
    <View style={styles.commitWrap}>
      <Mono size={9} style={styles.groupLabel}>
        A · 操作
      </Mono>
      <View style={styles.options}>
        {actionOpts.map((o, i) => (
          <OptionRow
            key={o.id}
            option={o}
            index={i}
            selected={actionId === o.id}
            marker="dot"
            onPress={() => pickAction(o.id)}
          />
        ))}
      </View>

      <Mono size={9} style={[styles.groupLabel, styles.groupLabelSpaced]}>
        B · 持仓时长
      </Mono>
      <View style={styles.options}>
        {durationOpts.map((o, i) => (
          <OptionRow
            key={o.id}
            option={o}
            index={i}
            selected={durationId === o.id}
            marker="dot"
            onPress={() => pickDuration(o.id)}
          />
        ))}
      </View>

      <Mono size={9} style={[styles.groupLabel, styles.groupLabelSpaced]}>
        C · 你的理由 + 退出条件
      </Mono>
      {(question.open_prompts ?? []).map((p, i) => (
        <Serif key={i} size={13} italic style={styles.openPrompt}>
          <RichText text={p} />
        </Serif>
      ))}
      <InputTrigger
        value={text}
        placeholder="为什么是这个操作 + 时长? 写下退出条件 (价格 + 时间 + 一条外部信号)."
        onPress={() => setModalOpen(true)}
      />
      <TextInputModal
        visible={modalOpen}
        title="你的理由 + 退出条件"
        placeholder="为什么是这个操作 + 时长? 写下退出条件 (价格 + 时间 + 一条外部信号)."
        value={text}
        hints={question.open_prompts}
        onSave={(t) => {
          changeText(t);
          setModalOpen(false);
        }}
        onCancel={() => setModalOpen(false)}
      />
    </View>
  );
}

// ───── shared OptionRow ─────

interface OptionRowProps {
  option: QuestionOption;
  index: number;
  selected: boolean;
  marker: "dot" | "square" | "rank";
  rank?: number;
  onPress: () => void;
  userText?: string;
  onUserTextChange?: (s: string) => void;
}

function OptionRow({
  option,
  index,
  selected,
  marker,
  rank,
  onPress,
  userText,
  onUserTextChange,
}: OptionRowProps) {
  const isUserInput = !!option.is_user_input;
  const [modalOpen, setModalOpen] = useState(false);

  return (
    <View>
      <TapEffect
        onPress={onPress}
        style={[optionStyles.option, selected && optionStyles.optionSelected]}
        pressedStyle={styles.optionPressed}
      >
        <View style={optionStyles.optionMarker}>
          {marker === "dot" ? (
            <View style={[optionStyles.dot, selected && optionStyles.dotSelected]} />
          ) : marker === "square" ? (
            <View style={[optionStyles.square, selected && optionStyles.squareSelected]} />
          ) : (
            <Mono size={11} style={[optionStyles.rank, selected && optionStyles.rankSelected]}>
              {rank ?? indexLabel(index)}
            </Mono>
          )}
        </View>
        <Serif
          size={14}
          italic={isUserInput}
          style={[
            styles.optionText,
            selected && optionStyles.optionTextSelected,
            isUserInput && styles.userInputLabel,
          ]}
        >
          <RichText text={option.text} />
        </Serif>
      </TapEffect>
      {isUserInput && selected ? (
        <>
          <InputTrigger
            value={userText ?? ""}
            placeholder="写下你看到的那条链 — 哪个被忽略的环节, 哪个角度被市场漏掉"
            onPress={() => setModalOpen(true)}
            small
          />
          <TextInputModal
            visible={modalOpen}
            title="你看到的那条链"
            placeholder="哪个被忽略的环节, 哪个角度被市场漏掉"
            value={userText ?? ""}
            onSave={(t) => {
              onUserTextChange?.(t);
              setModalOpen(false);
            }}
            onCancel={() => setModalOpen(false)}
          />
        </>
      ) : null}
    </View>
  );
}

// ───── helpers ─────

function kindLabel(k: QuestionKindT): string {
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
  // i 是 0-based index. 显示罗马字母 a/b/c/d.
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
  optionPressed: {
    backgroundColor: theme.color.paperPressed,
  },
  optionText: {
    flex: 1,
    color: theme.color.ink2,
    lineHeight: 22,
  },
  openWrap: {
    gap: theme.spacing.md,
  },
  openPrompt: {
    color: theme.color.muted,
  },
  openInput: {
    minHeight: 140,
    fontFamily: "SourceSerif4-Regular",
    fontSize: 15,
    lineHeight: 24,
    color: theme.color.ink,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    padding: theme.spacing.md,
    textAlignVertical: "top",
  },
  userInputLabel: {
    color: theme.color.muted,
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
  userInputField: {
    minHeight: 90,
    fontFamily: "SourceSerif4-Regular",
    fontSize: 14,
    lineHeight: 22,
    color: theme.color.ink,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    backgroundColor: theme.color.paper3,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    marginTop: theme.spacing.xs,
    textAlignVertical: "top",
  },
});
