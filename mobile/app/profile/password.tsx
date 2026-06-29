import { useReducer } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  KeyboardForm,
  ModalTopBar,
  Sans,
  Serif,
  TapEffect,
} from "@/shared/components";
import { NativeField, UI, MODS, hasNativeUI } from "@/shared/native";
import { theme, useThemeColors } from "@/core/theme";
import { changePassword, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { formFieldStyles } from "@/shared/styles/form";

/**
 * 修改密码 modal. 改密码后 server 会吊销所有 session, 客户端清 store + 跳 login.
 *
 * 双路渲染: hasNativeUI 走原生 SwiftUI Form (大标题 + 分组 SecureField); 回退路径 (Android /
 * Expo Go / 未 rebuild) 走自绘报刊式表单 + NativeField. 表单态提在本屏 (patch reducer), 两路
 * 共用; 底部「保存并退出」按钮也共用. 原生 SecureField 非受控, 故只 onChangeText 回写状态.
 */

// 改密表单一组相关状态 (三个输入 + 提交态/错误), 用 patch reducer 攒成一个,
// setForm({...}) 局部更新, 替代散开的多个 setState.
interface FormState {
  oldPassword: string;
  newPassword: string;
  confirm: string;
  pending: boolean;
  error: string | null;
}
type FormAction = Partial<FormState>;
function formReducer(s: FormState, patch: FormAction): FormState {
  return { ...s, ...patch };
}

export default function PasswordScreen() {
  const { t } = useTranslation();
  const clear = useAuth((s) => s.clear);
  const [form, setForm] = useReducer(formReducer, {
    oldPassword: "",
    newPassword: "",
    confirm: "",
    pending: false,
    error: null,
  });

  const canSubmit =
    form.oldPassword.length > 0 &&
    form.newPassword.length >= 8 &&
    form.newPassword === form.confirm &&
    !form.pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setForm({ pending: true, error: null });
    try {
      await changePassword({ old_password: form.oldPassword, new_password: form.newPassword });
      // server 已经吊销全部 session — 客户端清掉并跳 login.
      await clear();
      router.replace("/login");
    } catch (err) {
      setForm({ error: await readErrorMessage(err) });
    } finally {
      setForm({ pending: false });
    }
  }

  const mismatch = form.confirm.length > 0 && form.confirm !== form.newPassword;

  // 原生路径: SwiftUI Form 自带键盘避让 (故不套 KeyboardAvoidingView); 「保存」提到顶栏右上角,
  // 键盘/输入区永远盖不到它 (iOS modal 标准: 左取消 / 右保存). 仅 canSubmit 时可点.
  if (hasNativeUI) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ModalTopBar
          label={t("profile.password.topBar")}
          action={{
            label: form.pending ? t("profile.saving") : t("common.save"),
            onPress: handleSubmit,
            disabled: !canSubmit,
          }}
        />
        <NativePassword
          onChangeOld={(v) => setForm({ oldPassword: v })}
          onChangeNew={(v) => setForm({ newPassword: v })}
          onChangeConfirm={(v) => setForm({ confirm: v })}
          onSubmit={handleSubmit}
          mismatch={mismatch}
          error={form.error}
        />
      </SafeAreaView>
    );
  }

  // 回退路径 (Android / Expo Go / 未 rebuild): RN ScrollView + KeyboardAvoidingView 顶起底部按钮.
  return (
    <KeyboardForm>
      <ModalTopBar label={t("profile.password.topBar")} />
      <FallbackPassword form={form} setForm={setForm} mismatch={mismatch} onSubmit={handleSubmit} />
      <View style={styles.footer}>
        <TapEffect
          style={[styles.signButton, !canSubmit && styles.signButtonDim]}
          pressedStyle={{ backgroundColor: theme.color.ink2 }}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Sans size={11} weight="700" style={styles.signLabel}>
            {form.pending ? t("profile.saving") : t("profile.password.saveAndExit")}
          </Sans>
        </TapEffect>
      </View>
    </KeyboardForm>
  );
}

/** 原生 SwiftUI Form 路径 —— 大标题 + 当前/新/确认 三组 SecureField, 提示/校验走 section footer. */
function NativePassword({
  onChangeOld,
  onChangeNew,
  onChangeConfirm,
  onSubmit,
  mismatch,
  error,
}: {
  onChangeOld: (v: string) => void;
  onChangeNew: (v: string) => void;
  onChangeConfirm: (v: string) => void;
  onSubmit: () => void;
  mismatch: boolean;
  error: string | null;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();

  const { Host, Form, Section, SecureField, Text: T } = UI!;
  const {
    foregroundStyle,
    tint,
    listRowBackground,
    listRowInsets,
    listRowSeparator,
    scrollContentBackground,
    submitLabel,
    font,
  } = MODS!;

  // 确认行 footer: 优先显示「两次不一致」(muted), 其次后端错误 (red).
  const confirmFooter = mismatch ? (
    <T modifiers={[font({ size: 12 }), foregroundStyle(c.muted)]}>
      {t("profile.password.mismatch")}
    </T>
  ) : error ? (
    <T modifiers={[font({ size: 12 }), foregroundStyle(c.red)]}>{error}</T>
  ) : undefined;

  return (
    <Host style={styles.nativeHost}>
      <Form modifiers={[scrollContentBackground("hidden"), tint(c.red)]}>
        {/* 原生大标题 + 提示 footer —— 与 profile 主页同款. */}
        <Section
          modifiers={[
            listRowBackground(c.paper),
            listRowInsets({ top: 4, leading: 20, bottom: 6, trailing: 20 }),
            listRowSeparator("hidden"),
          ]}
          footer={
            <T modifiers={[font({ size: 12 }), foregroundStyle(c.muted)]}>
              {t("profile.password.hint")}
            </T>
          }
        >
          <T modifiers={[font({ size: 34, weight: "bold" }), foregroundStyle(c.ink)]}>
            {t("profile.password.title")}
          </T>
        </Section>

        <Section title={t("profile.password.oldLabel")} modifiers={[listRowBackground(c.paper2)]}>
          <SecureField
            placeholder={t("profile.password.oldPlaceholder")}
            onChangeText={onChangeOld}
          />
        </Section>

        <Section title={t("profile.password.newLabel")} modifiers={[listRowBackground(c.paper2)]}>
          <SecureField
            placeholder={t("profile.password.newPlaceholder")}
            onChangeText={onChangeNew}
          />
        </Section>

        <Section
          title={t("profile.password.confirmLabel")}
          modifiers={[listRowBackground(c.paper2)]}
          footer={confirmFooter}
        >
          <SecureField
            placeholder={t("profile.password.confirmPlaceholder")}
            onChangeText={onChangeConfirm}
            onSubmit={onSubmit}
            modifiers={[submitLabel("go")]}
          />
        </Section>
      </Form>
    </Host>
  );
}

/** 自绘回退路径 (Android / Expo Go / 未 rebuild) —— 报刊式表单 + NativeField. */
function FallbackPassword({
  form,
  setForm,
  mismatch,
  onSubmit,
}: {
  form: FormState;
  setForm: (patch: FormAction) => void;
  mismatch: boolean;
  onSubmit: () => void;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
      <Display size={26} italic style={styles.title}>
        {t("profile.password.title")}
      </Display>
      <DoubleRule />
      <Serif size={13} italic style={styles.hint}>
        {t("profile.password.hint")}
      </Serif>

      <Sans size={11} weight="600" style={styles.label}>
        {t("profile.password.oldLabel")}
      </Sans>
      <NativeField
        value={form.oldPassword}
        onChangeText={(text) => setForm({ oldPassword: text })}
        secure
        placeholder={t("profile.password.oldPlaceholder")}
        autoComplete="current-password"
        textContentType="password"
      />

      <Sans size={11} weight="600" style={styles.label}>
        {t("profile.password.newLabel")}
      </Sans>
      <NativeField
        value={form.newPassword}
        onChangeText={(text) => setForm({ newPassword: text })}
        secure
        placeholder={t("profile.password.newPlaceholder")}
        autoComplete="new-password"
        textContentType="newPassword"
      />

      <Sans size={11} weight="600" style={styles.label}>
        {t("profile.password.confirmLabel")}
      </Sans>
      <NativeField
        value={form.confirm}
        onChangeText={(text) => setForm({ confirm: text })}
        secure
        placeholder={t("profile.password.confirmPlaceholder")}
        autoComplete="new-password"
        textContentType="newPassword"
        returnKeyType="go"
        onSubmit={onSubmit}
      />

      {mismatch ? (
        <Serif size={12} italic style={styles.errorSoft}>
          {t("profile.password.mismatch")}
        </Serif>
      ) : null}

      {form.error ? (
        <Serif size={12} italic style={styles.error}>
          {form.error}
        </Serif>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  ...formFieldStyles,
  root: { flex: 1, backgroundColor: theme.color.paper },
  nativeHost: { flex: 1, backgroundColor: theme.color.paper },
  // ScrollView 占满 topBar 与底部按钮之间的空间 (而非撑到内容高度), 否则长内容会把
  // footer 顶出屏外 / 被键盘盖住 (见登录页同款 KeyboardForm 布局).
  flex: { flex: 1 },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  title: { marginBottom: theme.spacing.sm },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  errorSoft: { color: theme.color.muted, marginTop: theme.spacing.sm },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
});
