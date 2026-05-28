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
import { router } from "expo-router";
import { ChevronLeft } from "lucide-react-native";

import { Display, DoubleRule, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { changePassword, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";

/**
 * 修改密码 modal. 改密码后 server 会吊销所有 session, 客户端清 store + 跳 login.
 */
export default function PasswordScreen() {
  const clear = useAuth((s) => s.clear);
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    oldPassword.length > 0 &&
    newPassword.length >= 8 &&
    newPassword === confirm &&
    !pending;

  async function handleSubmit() {
    if (!canSubmit) return;
    setPending(true);
    setError(null);
    try {
      await changePassword({ old_password: oldPassword, new_password: newPassword });
      // server 已经吊销全部 session — 客户端清掉并跳 login.
      await clear();
      router.replace("/login");
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
        <View style={styles.topBar}>
          <TapEffect style={styles.backBtn} onPress={() => router.back()}>
            <ChevronLeft size={22} color={theme.color.ink} strokeWidth={1.5} />
          </TapEffect>
          <Mono size={10} style={styles.topMeta}>
            修改密码 · PASSWORD
          </Mono>
          <View style={styles.backBtn} />
        </View>

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
          <TextInput
            value={oldPassword}
            onChangeText={setOldPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="当前密码"
            placeholderTextColor={theme.color.muted2}
            style={styles.input}
          />

          <Sans size={11} weight="600" style={styles.label}>
            新密码
          </Sans>
          <TextInput
            value={newPassword}
            onChangeText={setNewPassword}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="至少 8 位"
            placeholderTextColor={theme.color.muted2}
            style={styles.input}
          />

          <Sans size={11} weight="600" style={styles.label}>
            确认新密码
          </Sans>
          <TextInput
            value={confirm}
            onChangeText={setConfirm}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="再输一次"
            placeholderTextColor={theme.color.muted2}
            style={styles.input}
            onSubmitEditing={handleSubmit}
          />

          {confirm.length > 0 && confirm !== newPassword ? (
            <Serif size={12} italic style={styles.errorSoft}>
              两次输入不一致。
            </Serif>
          ) : null}

          {error ? (
            <Serif size={12} italic style={styles.error}>
              {error}
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
              {pending ? "保存中…" : "保存并退出"}
            </Sans>
          </TapEffect>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  flex: { flex: 1 },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  topMeta: { color: theme.color.muted, letterSpacing: 2, textTransform: "uppercase" },
  scroll: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.xxl },
  title: { marginBottom: theme.spacing.sm },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.lg,
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
  error: { color: theme.color.red, marginTop: theme.spacing.lg },
  errorSoft: { color: theme.color.muted, marginTop: theme.spacing.sm },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.md,
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
});
