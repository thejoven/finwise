/**
 * TextInputModal — 长文本输入用全屏模态.
 *
 * 为什么: refinement R4/R5 用户要写一段话, 内联 TextInput + 键盘 + ScrollView
 * 组合很难做到稳定的"输入框始终可见". 弹出全屏 modal 干掉这层复杂性:
 *   - Modal 占满屏幕, 键盘只跟 TextInput 一个组件交互
 *   - 大输入区, 专注写作
 *   - 顶部明确 "取消" / "保存", 不会"找不到怎么关键盘"
 *
 * 视觉:
 *   ─ 顶栏 (取消 · 标题 · 保存)
 *   ─ DoubleRule
 *   ─ open_prompts 提示 (italic Serif)
 *   ─ 大 TextInput (flex: 1)
 *   ─ 底部 Mono 字数计数
 *
 * 行为:
 *   - autoFocus + scrollEnabled, 多行内可滚
 *   - 取消 → onCancel (调用方处理: 弃改 / 保留原值)
 *   - 保存 → onSave(text), 调用方更新 state
 *   - Android 硬件返回键 → 视同取消
 */

import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Modal, Platform, StyleSheet, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Display, DoubleRule, Mono, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  visible: boolean;
  /** 标题, 例 "你的回答" / "你的理由 + 退出条件" */
  title: string;
  /** 占位文字 */
  placeholder: string;
  /** 当前值 (打开 modal 时复制为内部 draft) */
  value: string;
  /** 可选附加提示, 一行 italic Serif. 多行也行 (LLM 的 open_prompts) */
  hints?: string[];
  onSave: (text: string) => void;
  onCancel: () => void;
}

export function TextInputModal({
  visible,
  title,
  placeholder,
  value,
  hints,
  onSave,
  onCancel,
}: Props) {
  const [draft, setDraft] = useState(value);

  // 打开时把外部 value 同步到 draft (防止上次未保存的 draft 残留)
  useEffect(() => {
    if (visible) setDraft(value);
  }, [visible, value]);

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle={Platform.OS === "ios" ? "pageSheet" : undefined}
      onRequestClose={onCancel}
    >
      <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
        <View style={styles.headerBar}>
          <TapEffect onPress={onCancel} style={styles.headerBtn} disableEffect>
            <Serif size={13} style={styles.headerLeft}>
              取消
            </Serif>
          </TapEffect>
          <View style={styles.headerCenter}>
            <Mono size={9} style={styles.headerStamp}>
              输入
            </Mono>
          </View>
          <TapEffect onPress={() => onSave(draft.trim())} style={styles.headerBtn} disableEffect>
            <Serif size={13} weight="semibold" style={styles.headerRight}>
              保存
            </Serif>
          </TapEffect>
        </View>

        <KeyboardAvoidingView
          behavior={Platform.OS === "ios" ? "padding" : undefined}
          style={styles.flex}
        >
          <View style={styles.body}>
            <Display size={20} style={styles.title}>
              {title}
            </Display>
            <DoubleRule />
            {hints && hints.length > 0 ? (
              <View style={styles.hintBlock}>
                {hints.map((h, i) => (
                  <Serif key={i} size={13} italic style={styles.hint}>
                    {h}
                  </Serif>
                ))}
              </View>
            ) : null}
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder={placeholder}
              placeholderTextColor={theme.color.muted2}
              multiline
              autoFocus
              scrollEnabled
              textAlignVertical="top"
              style={styles.input}
            />
            <View style={styles.footRow}>
              <Mono size={9} style={styles.charCount}>
                {`${draft.length} 字`}
              </Mono>
            </View>
          </View>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  flex: { flex: 1 },
  headerBar: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  headerBtn: {
    paddingVertical: theme.spacing.xs,
    minWidth: 56,
  },
  headerLeft: {
    color: theme.color.muted,
  },
  headerCenter: {
    flex: 1,
    alignItems: "center",
  },
  headerStamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  headerRight: {
    color: theme.color.ink,
    textAlign: "right",
  },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  title: {
    color: theme.color.ink,
    lineHeight: 28,
  },
  hintBlock: {
    gap: theme.spacing.xs,
  },
  hint: {
    color: theme.color.muted,
    lineHeight: 20,
  },
  input: {
    flex: 1,
    fontFamily: "SourceSerif4-Regular",
    fontSize: 16,
    lineHeight: 26,
    color: theme.color.ink,
    paddingVertical: theme.spacing.md,
    textAlignVertical: "top",
  },
  footRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingBottom: theme.spacing.sm,
  },
  charCount: {
    color: theme.color.muted2,
    letterSpacing: 1,
  },
});
