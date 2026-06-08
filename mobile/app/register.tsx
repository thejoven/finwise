import { useReducer } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Link, router } from "expo-router";

import { Display, DoubleRule, KeyboardForm, Sans, Serif, TapEffect } from "@/shared/components";
import { NativeField } from "@/shared/native";
import { theme } from "@/core/theme";
import { register, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { formFieldStyles } from "@/shared/styles/form";

/**
 * 注册屏. 邀请码 + 邮箱 + 密码 + 昵称 (可选). 不发邮件验证码 — 产品决策.
 *
 * 邀请码必填: 注册受邀请制门禁, 码由管理员在后台生成 (见 server invite 模块).
 * 密码长度最低 8, 跟后端一致. UI 错误信息直接落表单底部.
 */

// 注册表单是一坨相关状态 (四个输入 + 提交态/错误), 用 patch reducer 攒成一个,
// setForm({...}) 局部更新, 替代散开的多个 setState.
interface FormState {
  inviteCode: string;
  email: string;
  password: string;
  displayName: string;
  pending: boolean;
  error: string | null;
}
type FormAction = Partial<FormState>;
function formReducer(s: FormState, patch: FormAction): FormState {
  return { ...s, ...patch };
}

export default function RegisterScreen() {
  const [form, setForm] = useReducer(formReducer, {
    inviteCode: "",
    email: "",
    password: "",
    displayName: "",
    pending: false,
    error: null,
  });
  const setSession = useAuth((s) => s.setSession);

  const trimmedEmail = form.email.trim();
  const trimmedName = form.displayName.trim();
  const trimmedInvite = form.inviteCode.trim();
  const canSubmit =
    trimmedInvite.length > 0 &&
    trimmedEmail.length > 0 &&
    form.password.length >= 8 &&
    !form.pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setForm({ pending: true, error: null });
    try {
      const res = await register({
        email: trimmedEmail,
        password: form.password,
        display_name: trimmedName.length > 0 ? trimmedName : null,
        invite_code: trimmedInvite,
      });
      await setSession({
        token: res.session.token,
        expires_at: res.session.expires_at,
        user: res.user,
      });
      router.replace("/(tabs)/caizhi");
    } catch (err) {
      setForm({ error: await readErrorMessage(err) });
    } finally {
      setForm({ pending: false });
    }
  }

  return (
    <KeyboardForm>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Display size={30} italic style={styles.title}>
            注册.
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            注册需要邀请码。{"\n"}向管理员索取后填入下方即可。
          </Serif>

          <Sans size={11} weight="600" style={styles.label}>
            邀请码
          </Sans>
          <NativeField
            value={form.inviteCode}
            onChangeText={(text) => setForm({ inviteCode: text })}
            placeholder="管理员发给你的邀请码"
            autoCapitalize="characters"
            autoComplete="off"
            returnKeyType="next"
          />

          <Sans size={11} weight="600" style={styles.label}>
            邮箱
          </Sans>
          <NativeField
            value={form.email}
            onChangeText={(text) => setForm({ email: text })}
            placeholder="you@example.com"
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <Sans size={11} weight="600" style={styles.label}>
            密码
          </Sans>
          <NativeField
            value={form.password}
            onChangeText={(text) => setForm({ password: text })}
            placeholder="至少 8 位"
            secure
            autoComplete="new-password"
            textContentType="newPassword"
            returnKeyType="next"
          />

          <Sans size={11} weight="600" style={styles.label}>
            昵称 (可选)
          </Sans>
          <NativeField
            value={form.displayName}
            onChangeText={(text) => setForm({ displayName: text })}
            placeholder="想被怎么称呼"
            autoCapitalize="sentences"
            maxLength={60}
            returnKeyType="go"
            onSubmit={handleSubmit}
          />

          {form.error ? (
            <Serif size={12} italic style={styles.error}>
              {form.error}
            </Serif>
          ) : null}
        </View>

        <View style={styles.footer}>
          <TapEffect
            style={[styles.signButton, !canSubmit && styles.signButtonDim]}
            pressedStyle={{ backgroundColor: theme.color.ink2 }}
            onPress={handleSubmit}
            disabled={!canSubmit}
          >
            <Sans size={11} weight="700" style={styles.signLabel}>
              {form.pending ? "注册中…" : "注册"}
            </Sans>
          </TapEffect>
          <Link href="/login" asChild>
            <TapEffect style={styles.linkRow} disableEffect>
              <Serif size={12} italic style={styles.linkLabel}>
                已有账号 · 登录
              </Serif>
            </TapEffect>
          </Link>
        </View>
      </ScrollView>
    </KeyboardForm>
  );
}

const styles = StyleSheet.create({
  ...formFieldStyles,
  scroll: { flexGrow: 1, justifyContent: "space-between" },
  body: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
  },
  title: { marginBottom: theme.spacing.sm },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.xl,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  linkRow: { alignItems: "center", paddingVertical: theme.spacing.sm },
  linkLabel: { color: theme.color.muted },
});
