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
import { updateMe, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";

/**
 * 编辑资料 modal. 改 display_name + bio. (avatar 暂不开放上传, 等 storage 落.)
 */
export default function ProfileEditScreen() {
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const [displayName, setDisplayName] = useState(user?.display_name ?? "");
  const [bio, setBio] = useState(user?.bio ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSave() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const trimmedName = displayName.trim();
      const trimmedBio = bio.trim();
      const updated = await updateMe({
        display_name: trimmedName === "" ? null : trimmedName,
        bio: trimmedBio === "" ? null : trimmedBio,
      });
      await setUser({
        id: updated.id,
        email: updated.email,
        display_name: updated.display_name ?? null,
        avatar_url: updated.avatar_url ?? null,
        bio: updated.bio ?? null,
        created_at: updated.created_at,
      });
      router.back();
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
            编辑资料 · PROFILE
          </Mono>
          <View style={styles.backBtn} />
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <Display size={26} italic style={styles.title}>
            编辑资料.
          </Display>
          <DoubleRule />
          <Serif size={13} italic style={styles.hint}>
            邮箱不能从这里修改。{"\n"}昵称和签名是公开的, 但目前只有你能看见。
          </Serif>

          <Sans size={11} weight="600" style={styles.label}>
            邮箱 (只读)
          </Sans>
          <Mono size={13} style={styles.readonly}>
            {user?.email ?? "—"}
          </Mono>

          <Sans size={11} weight="600" style={styles.label}>
            昵称
          </Sans>
          <TextInput
            value={displayName}
            onChangeText={setDisplayName}
            placeholder="想被怎么称呼"
            placeholderTextColor={theme.color.muted2}
            maxLength={60}
            style={styles.input}
          />

          <Sans size={11} weight="600" style={styles.label}>
            签名
          </Sans>
          <TextInput
            value={bio}
            onChangeText={setBio}
            placeholder="一句话介绍自己"
            placeholderTextColor={theme.color.muted2}
            multiline
            maxLength={280}
            style={[styles.input, styles.multiline]}
          />

          {error ? (
            <Serif size={12} italic style={styles.error}>
              {error}
            </Serif>
          ) : null}
        </ScrollView>

        <View style={styles.footer}>
          <TapEffect
            style={[styles.signButton, pending && styles.signButtonDim]}
            pressedStyle={{ backgroundColor: theme.color.ink2 }}
            onPress={handleSave}
            disabled={pending}
          >
            <Sans size={11} weight="700" style={styles.signLabel}>
              {pending ? "保存中…" : "保存"}
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
  readonly: {
    color: theme.color.ink2,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
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
  multiline: { minHeight: 96, textAlignVertical: "top" },
  error: { color: theme.color.red, marginTop: theme.spacing.lg },
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
