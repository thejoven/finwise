import { useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Link, router } from "expo-router";

import { Display, Sans, Serif, TapEffect, DoubleRule } from "@/shared/components";
import { theme } from "@/core/theme";
import { register, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";

/**
 * 注册屏. 邮箱 + 密码 + 昵称 (可选). 不发邮件验证码 — 产品决策.
 *
 * 密码长度最低 8, 跟后端一致. UI 错误信息直接落表单底部.
 */
export default function RegisterScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setSession = useAuth((s) => s.setSession);

  const trimmedEmail = email.trim();
  const trimmedName = displayName.trim();
  const canSubmit = trimmedEmail.length > 0 && password.length >= 8 && !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      const res = await register({
        email: trimmedEmail,
        password,
        display_name: trimmedName.length > 0 ? trimmedName : null,
      });
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
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.body}>
            <Display size={30} italic style={styles.title}>
              注册.
            </Display>
            <DoubleRule />
            <Serif size={13} italic style={styles.hint}>
              邮箱 + 密码, 不需要验证码。{"\n"}你可以随后再补昵称和签名。
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
              autoComplete="new-password"
              textContentType="newPassword"
              style={styles.input}
            />

            <Sans size={11} weight="600" style={styles.label}>
              昵称 (可选)
            </Sans>
            <TextInput
              value={displayName}
              onChangeText={setDisplayName}
              placeholder="想被怎么称呼"
              placeholderTextColor={theme.color.muted2}
              autoCorrect={false}
              maxLength={60}
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
                {pending ? "注册中…" : "注册"}
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
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  flex: { flex: 1 },
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
  label: {
    color: theme.color.muted,
    letterSpacing: 1.5,
    textTransform: "uppercase",
    marginBottom: theme.spacing.xs,
    marginTop: theme.spacing.md,
  },
  input: {
    fontFamily: theme.fontFamily.serifRegular,
    fontSize: 16,
    lineHeight: 24,
    color: theme.color.ink,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  error: {
    color: theme.color.red,
    marginTop: theme.spacing.lg,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  signButton: {
    backgroundColor: theme.color.ink,
    borderRadius: theme.radius.none,
    paddingVertical: theme.spacing.md,
    alignItems: "center",
  },
  signButtonDim: { backgroundColor: theme.color.muted2 },
  signLabel: {
    color: theme.color.paper,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  linkRow: { alignItems: "center", paddingVertical: theme.spacing.sm },
  linkLabel: { color: theme.color.muted },
});
