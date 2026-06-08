import { useReducer } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";

import {
  Display,
  DoubleRule,
  KeyboardForm,
  ModalTopBar,
  Sans,
  Serif,
  TapEffect,
} from "@/shared/components";
import { NativeField } from "@/shared/native";
import { theme } from "@/core/theme";
import { changePassword, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { formFieldStyles } from "@/shared/styles/form";

/**
 * 修改密码 modal. 改密码后 server 会吊销所有 session, 客户端清 store + 跳 login.
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

  return (
    <KeyboardForm>
      <ModalTopBar label="修改密码 · PASSWORD" />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Display size={26} italic style={styles.title}>
          修改密码.
        </Display>
        <DoubleRule />
        <Serif size={13} italic style={styles.hint}>
          修改后, 所有设备会被退出登录, 你需要用新密码重新登录。
        </Serif>

        <Sans size={11} weight="600" style={styles.label}>
          原密码
        </Sans>
        <NativeField
          value={form.oldPassword}
          onChangeText={(text) => setForm({ oldPassword: text })}
          secure
          placeholder="当前密码"
          autoComplete="current-password"
          textContentType="password"
        />

        <Sans size={11} weight="600" style={styles.label}>
          新密码
        </Sans>
        <NativeField
          value={form.newPassword}
          onChangeText={(text) => setForm({ newPassword: text })}
          secure
          placeholder="至少 8 位"
          autoComplete="new-password"
          textContentType="newPassword"
        />

        <Sans size={11} weight="600" style={styles.label}>
          确认新密码
        </Sans>
        <NativeField
          value={form.confirm}
          onChangeText={(text) => setForm({ confirm: text })}
          secure
          placeholder="再输一次"
          autoComplete="new-password"
          textContentType="newPassword"
          returnKeyType="go"
          onSubmit={handleSubmit}
        />

        {form.confirm.length > 0 && form.confirm !== form.newPassword ? (
          <Serif size={12} italic style={styles.errorSoft}>
            两次输入不一致。
          </Serif>
        ) : null}

        {form.error ? (
          <Serif size={12} italic style={styles.error}>
            {form.error}
          </Serif>
        ) : null}
      </ScrollView>

      <View style={styles.footer}>
        <TapEffect
          style={[styles.signButton, !canSubmit && styles.signButtonDim]}
          pressedStyle={{ backgroundColor: theme.color.ink2 }}
          onPress={handleSubmit}
          disabled={!canSubmit}
        >
          <Sans size={11} weight="700" style={styles.signLabel}>
            {form.pending ? "保存中…" : "保存并退出"}
          </Sans>
        </TapEffect>
      </View>
    </KeyboardForm>
  );
}

const styles = StyleSheet.create({
  ...formFieldStyles,
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
