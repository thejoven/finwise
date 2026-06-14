import { useState } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  KeyboardForm,
  ModalTopBar,
  Mono,
  Sans,
  Serif,
  TapEffect,
} from "@/shared/components";
import { NativeField } from "@/shared/native";
import { theme } from "@/core/theme";
import { updateMe, readErrorMessage } from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { formFieldStyles } from "@/shared/styles/form";

/**
 * 编辑资料 modal. 改 display_name + bio. (avatar 暂不开放上传, 等 storage 落.)
 */
export default function ProfileEditScreen() {
  const { t } = useTranslation();
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
    <KeyboardForm>
      <ModalTopBar label={t("profile.edit.topBar")} />

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Display size={26} italic style={styles.title}>
          {t("profile.edit.title")}
        </Display>
        <DoubleRule />
        <Serif size={13} italic style={styles.hint}>
          {t("profile.edit.hint")}
        </Serif>

        <Sans size={11} weight="600" style={styles.label}>
          {t("profile.edit.emailLabel")}
        </Sans>
        <Mono size={13} style={styles.readonly}>
          {user?.email ?? "—"}
        </Mono>

        <Sans size={11} weight="600" style={styles.label}>
          {t("profile.edit.nameLabel")}
        </Sans>
        <NativeField
          value={displayName}
          onChangeText={setDisplayName}
          placeholder={t("profile.edit.namePlaceholder")}
          autoCapitalize="sentences"
          maxLength={60}
        />

        <Sans size={11} weight="600" style={styles.label}>
          {t("profile.edit.bioLabel")}
        </Sans>
        <NativeField
          value={bio}
          onChangeText={setBio}
          placeholder={t("profile.edit.bioPlaceholder")}
          autoCapitalize="sentences"
          multiline
          maxLength={280}
          minHeight={96}
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
            {pending ? t("profile.saving") : t("common.save")}
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
  readonly: {
    color: theme.color.ink2,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  footer: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
});
