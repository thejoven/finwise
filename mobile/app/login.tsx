import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Link, router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Display, DoubleRule, KeyboardForm, Sans, Serif, TapEffect } from "@/shared/components";
import { NativeField } from "@/shared/native";
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
  const { t } = useTranslation();

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
      router.replace("/(tabs)/caizhi");
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
            {t("auth.login.title")}
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            {t("auth.login.hint")}
          </Serif>

          <Sans size={11} weight="600" style={styles.label}>
            {t("auth.login.emailLabel")}
          </Sans>
          <NativeField
            value={email}
            onChangeText={setEmail}
            placeholder={t("auth.login.emailPlaceholder")}
            keyboardType="email-address"
            autoComplete="email"
            textContentType="emailAddress"
            returnKeyType="next"
          />

          <Sans size={11} weight="600" style={styles.label}>
            {t("auth.login.passwordLabel")}
          </Sans>
          <NativeField
            value={password}
            onChangeText={setPassword}
            placeholder={t("auth.login.passwordPlaceholder")}
            secure
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmit={handleSubmit}
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
              {pending ? t("auth.login.submitting") : t("auth.login.submit")}
            </Sans>
          </TapEffect>
          <Link href="/register" asChild>
            <TapEffect style={styles.linkRow} disableEffect>
              <Serif size={12} italic style={styles.linkLabel}>
                {t("auth.login.toRegister")}
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
