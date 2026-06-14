import { useState } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Display, Serif, Sans, TapEffect, DoubleRule } from "@/shared/components";
import { NativeField } from "@/shared/native";
import { theme } from "@/core/theme";
import { CaptureCategoryPicker, useCaptureSignal } from "@/features/capture";
import { useActiveProject } from "@/features/project";

/**
 * B1 录入 — M4 实现.
 *
 * 流程:
 *   1) 打开 modal, TextInput 自动 focus
 *   2) 用户写一句话, 选一个分类 (必选, 默认带入当前 active 分类), 点 "记下"
 *   3) 立即写入本地 pending 队列 (UI 立刻看到), 后台 POST /v1/signals
 *   4) 切到本条记录所属分类, modal 关闭, 回 inbox; inbox 自动多出一条 "AI 推演中"
 *   5) POST 失败时, 条目留在 inbox 标 "未同步" (没有 toast, 没有 dialog)
 *
 * 反模式 (按 references/05):
 *   - 不弹 "已保存"
 *   - 不开 Haptics.notificationAsync(Success)
 *   - 不显示 ActivityIndicator / loading spinner
 *   - 关闭 modal 时不震动
 */
export default function CaptureModal() {
  const { t } = useTranslation();
  const [text, setText] = useState("");
  // 分类必选. 默认带入当前 active 分类 (没有则为 null, 用户须手选).
  const [projectId, setProjectId] = useState<string | null>(
    () => useActiveProject.getState().activeId,
  );
  const { submit, isSubmitting } = useCaptureSignal();

  const canSubmit = text.trim().length > 0 && projectId !== null && !isSubmitting;

  async function handleSubmit() {
    if (!canSubmit) return;
    const draft = text.trim();
    const category = projectId;
    if (!category) return;
    setText("");
    // 不 await 网络结果 — pending 队列已经 upsert, UI 立刻关闭即可.
    void submit(draft, category);
    // 录入页可临时改分类; 提交后让首页筛选主动跟到这条记录所属分类.
    void useActiveProject.getState().setActive(category);
    router.back();
  }

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <View style={styles.body}>
          <Display size={26} italic style={styles.title}>
            {t("capture.compose.title")}
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            {t("capture.compose.hint")}
          </Serif>

          <NativeField
            value={text}
            onChangeText={setText}
            placeholder={t("capture.compose.placeholder")}
            multiline
            autoFocus
            maxLength={2000}
            bare
            containerStyle={styles.inputWrap}
            inputStyle={styles.input}
          />
        </View>

        <CaptureCategoryPicker selectedId={projectId} onSelect={setProjectId} />

        <View style={styles.footer}>
          <TapEffect
            style={[styles.signButton, !canSubmit && styles.signButtonDim]}
            pressedStyle={{ backgroundColor: theme.color.ink2 }}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Sans size={11} weight="700" style={styles.signLabel}>
              {t("capture.compose.submit")}
            </Sans>
          </TapEffect>
          <TapEffect style={styles.cancel} onPress={() => router.back()} disableEffect>
            <Serif size={12} italic style={styles.cancelLabel}>
              {t("capture.compose.cancel")}
            </Serif>
          </TapEffect>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  flex: { flex: 1 },
  body: {
    flex: 1,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.lg,
  },
  title: {
    marginBottom: theme.spacing.sm,
  },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  inputWrap: { flex: 1 },
  input: {
    flex: 1,
    minHeight: 120,
    fontFamily: theme.fontFamily.serifRegular,
    fontSize: 17,
    lineHeight: 26,
    color: theme.color.ink,
    textAlignVertical: "top",
    padding: 0,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  signButton: {
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.none,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  signButtonDim: {
    backgroundColor: theme.color.muted2,
  },
  signLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  cancel: {
    alignItems: "center",
    paddingVertical: theme.spacing.sm,
  },
  cancelLabel: {
    color: theme.color.muted,
  },
});
