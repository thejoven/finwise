import { useState } from "react";
import { ScrollView, StyleSheet, TextInput, View } from "react-native";
import { Link, router } from "expo-router";

import { Display, DoubleRule, KeyboardForm, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { login, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { formFieldStyles } from "@/shared/styles/form";

/**
 * 登录屏.
 *
 * 视觉沿用 capture modal 的 Display 标题 + DoubleRule + 极简 input.
 * 错误信息不弹 toast, 直接落在表单底部一行小字.
 *
 * 不强制邮箱格式 — server 那边 mail.ParseAddress 校验, 这里只挡空和明显无效.
 */
export default function LoginScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuth((s) => s.setSession);

  const canSubmit = email.trim().length > 0 && password.length >= 1 && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const res = await login({ email: email.trim(), password });
      await setSession({
        token: res.session.token,
        expires_at: res.session.expires_at,
        user: res.user,
      });
      router.replace("/(tabs)/inbox");
    } catch (err) {
      setError(await readErrorMessage(err));
    } finally {
      setPending(false);
    }
  }

  return (
    <KeyboardForm>
      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <View style={styles.body}>
          <Display size={30} italic style={styles.title}>
            欢迎回来.
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            请输入你的邮箱和密码。{"\n"}没有账号? 可以注册一个。
          </Serif>

          <Sans size={11} weight="600" style={styles.label}>
            邮箱
          </Sans>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={theme.color.muted2}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            style={styles.input}
          />

          <Sans size={11} weight="600" style={styles.label}>
            密码
          </Sans>
          <TextInput
            value={password}
            onChangeText={setPassword}
            placeholder="至少 8 位"
            placeholderTextColor={theme.color.muted2}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="current-password"
            textContentType="password"
            style={styles.input}
            onSubmitEditing={handleSubmit}
          />

          {error ? (
            <Serif size={12} italic style={styles.error}>
              {error}
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
              {pending ? "登录中…" : "登录"}
            </Sans>
          </TapEffect>
          <Link href="/register" asChild>
            <TapEffect style={styles.linkRow} disableEffect>
              <Serif size={12} italic style={styles.linkLabel}>
                还没账号 · 注册
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
