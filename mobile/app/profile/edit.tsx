import { useState } from "react";
import {
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import * as ImagePicker from "expo-image-picker";

import {
  Avatar,
  Display,
  DoubleRule,
  Icon,
  KeyboardForm,
  ModalTopBar,
  Mono,
  Sans,
  Serif,
  TapEffect,
} from "@/shared/components";
import { NativeField, UI, MODS, hasNativeUI } from "@/shared/native";
import { theme, useThemeColors } from "@/core/theme";
import {
  updateMe,
  readErrorMessage,
  requestAvatarUploadUrl,
  putAvatarBytes,
  confirmAvatar,
  removeAvatar,
  type UserDTO,
} from "@/core/api/account";
import { useAuth } from "@/core/auth/store";
import { formFieldStyles } from "@/shared/styles/form";

/**
 * 编辑资料 modal. 改 display_name + bio. (avatar 暂不开放上传, 等 storage 落.)
 *
 * 双路渲染: hasNativeUI 走原生 SwiftUI Form (大标题 + 分组 TextField); 回退路径 (Android /
 * Expo Go / 未 rebuild) 走自绘报刊式表单 + NativeField. 状态 (昵称/简介) 提在本屏, 两路共用;
 * 底部「保存」按钮也共用, 始终在键盘之上可点. 原生 TextField 是非受控控件, 故只给 defaultValue
 * (挂载时的初值) + onChangeText 回写状态, 不把 state 再灌回控件.
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

  // 原生路径: SwiftUI Form 自带键盘避让 (故不套 KeyboardAvoidingView); 「保存」提到顶栏右上角,
  // 键盘/输入区永远盖不到它 (iOS modal 标准: 左取消 / 右保存).
  if (hasNativeUI) {
    return (
      <SafeAreaView style={styles.root} edges={["top"]}>
        <ModalTopBar
          label={t("profile.edit.topBar")}
          action={{
            label: pending ? t("profile.saving") : t("common.save"),
            onPress: handleSave,
            disabled: pending,
          }}
        />
        <AvatarPicker />
        <NativeEdit
          email={user?.email ?? "—"}
          initialName={user?.display_name ?? ""}
          initialBio={user?.bio ?? ""}
          onChangeName={setDisplayName}
          onChangeBio={setBio}
          error={error}
        />
      </SafeAreaView>
    );
  }

  // 回退路径 (Android / Expo Go / 未 rebuild): RN ScrollView + KeyboardAvoidingView 顶起底部按钮.
  return (
    <KeyboardForm>
      <ModalTopBar label={t("profile.edit.topBar")} />
      <AvatarPicker />
      <FallbackEdit
        email={user?.email ?? "—"}
        name={displayName}
        bio={bio}
        onChangeName={setDisplayName}
        onChangeBio={setBio}
        error={error}
      />
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

/**
 * 头像选择器 —— 圆形头像 + 相机角标, 居中. 两路 (原生 / 回退) 共用, 故是纯 RN (不进 SwiftUI Form).
 *
 * 流程: 点按 → iOS ActionSheet (相册 / 拍照 / 移除) 或 Android 直开相册 → 方形裁剪压缩 →
 * 取预签名 URL → 直传 R2 → confirm 校验落库 → 写回 auth store (头像即时刷新).
 * 自订阅 store 的 user, 不靠父级 props, 上传成功后整页头像同步更新.
 */
function AvatarPicker() {
  const { t } = useTranslation();
  const user = useAuth((s) => s.user);
  const setUser = useAuth((s) => s.setUser);
  const c = useThemeColors();
  const [busy, setBusy] = useState(false);

  const hasAvatar = !!user?.avatar_url;
  const name = user?.display_name?.trim() || user?.email || "";

  const applyUser = (u: UserDTO) =>
    setUser({
      id: u.id,
      email: u.email,
      display_name: u.display_name ?? null,
      avatar_url: u.avatar_url ?? null,
      bio: u.bio ?? null,
      created_at: u.created_at,
    });

  async function pickFrom(source: "library" | "camera") {
    try {
      const perm =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!perm.granted) {
        Alert.alert(t("profile.edit.avatar.permissionDenied"));
        return;
      }
      const opts: ImagePicker.ImagePickerOptions = {
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      };
      const result =
        source === "camera"
          ? await ImagePicker.launchCameraAsync(opts)
          : await ImagePicker.launchImageLibraryAsync({
              ...opts,
              mediaTypes: ["images"],
            });
      const asset = result.canceled ? undefined : result.assets[0];
      if (!asset) return;
      await uploadAsset(asset);
    } catch (err) {
      Alert.alert(t("profile.edit.avatar.failed"), await readErrorMessage(err));
    }
  }

  async function uploadAsset(asset: ImagePicker.ImagePickerAsset) {
    setBusy(true);
    try {
      const contentType = asset.mimeType ?? "image/jpeg";
      const { upload_url } = await requestAvatarUploadUrl();
      await putAvatarBytes(upload_url, asset.uri, contentType);
      applyUser(await confirmAvatar());
    } catch (err) {
      Alert.alert(t("profile.edit.avatar.failed"), await readErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      applyUser(await removeAvatar());
    } catch (err) {
      Alert.alert(t("profile.edit.avatar.failed"), await readErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function openMenu() {
    if (busy) return;
    // iOS: 原生 ActionSheet (相册 / 拍照 / 移除). Android (回退平台): 直开相册.
    if (Platform.OS !== "ios") {
      void pickFrom("library");
      return;
    }
    const labels = [
      t("profile.edit.avatar.library"),
      t("profile.edit.avatar.camera"),
      ...(hasAvatar ? [t("profile.edit.avatar.remove")] : []),
      t("profile.edit.avatar.cancel"),
    ];
    ActionSheetIOS.showActionSheetWithOptions(
      {
        title: t("profile.edit.avatar.menuTitle"),
        options: labels,
        cancelButtonIndex: labels.length - 1,
        destructiveButtonIndex: hasAvatar ? 2 : undefined,
      },
      (i) => {
        if (i === 0) void pickFrom("library");
        else if (i === 1) void pickFrom("camera");
        else if (hasAvatar && i === 2) void remove();
      },
    );
  }

  return (
    <View style={styles.avatarBlock}>
      <Pressable
        onPress={openMenu}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={hasAvatar ? t("profile.edit.avatar.cta") : t("profile.edit.avatar.add")}
        style={styles.avatarTap}
      >
        <Avatar uri={user?.avatar_url} name={name} size={84} />
        <View style={[styles.avatarBadge, { backgroundColor: c.ink, borderColor: c.paper }]}>
          {busy ? (
            <ActivityIndicator size="small" color={c.paper} />
          ) : (
            <Icon name="camera" size={13} color={c.paper} />
          )}
        </View>
      </Pressable>
      <Sans size={11} weight="600" style={styles.avatarCta}>
        {busy
          ? t("profile.edit.avatar.uploading")
          : hasAvatar
            ? t("profile.edit.avatar.cta")
            : t("profile.edit.avatar.add")}
      </Sans>
    </View>
  );
}

/** 原生 SwiftUI Form 路径 —— 大标题 + 邮箱(只读) / 昵称 / 简介 三组, 各组 section 标题作字段名. */
function NativeEdit({
  email,
  initialName,
  initialBio,
  onChangeName,
  onChangeBio,
  error,
}: {
  email: string;
  initialName: string;
  initialBio: string;
  onChangeName: (v: string) => void;
  onChangeBio: (v: string) => void;
  error: string | null;
}) {
  const c = useThemeColors();
  const { t } = useTranslation();

  const { Host, Form, Section, TextField, Text: T } = UI!;
  const {
    foregroundStyle,
    tint,
    listRowBackground,
    listRowInsets,
    listRowSeparator,
    scrollContentBackground,
    font,
  } = MODS!;

  return (
    <Host style={styles.nativeHost}>
      <Form modifiers={[scrollContentBackground("hidden"), tint(c.red)]}>
        {/* 原生大标题 —— 平铺于页底色, 与 profile 主页同款. */}
        <Section
          modifiers={[
            listRowBackground(c.paper),
            listRowInsets({ top: 4, leading: 20, bottom: 6, trailing: 20 }),
            listRowSeparator("hidden"),
          ]}
        >
          <T modifiers={[font({ size: 34, weight: "bold" }), foregroundStyle(c.ink)]}>
            {t("profile.edit.title")}
          </T>
        </Section>

        <Section title={t("profile.edit.emailLabel")} modifiers={[listRowBackground(c.paper2)]}>
          <T modifiers={[font({ size: 15 }), foregroundStyle(c.muted)]}>{email}</T>
        </Section>

        <Section title={t("profile.edit.nameLabel")} modifiers={[listRowBackground(c.paper2)]}>
          <TextField
            defaultValue={initialName}
            placeholder={t("profile.edit.namePlaceholder")}
            onChangeText={onChangeName}
          />
        </Section>

        <Section
          title={t("profile.edit.bioLabel")}
          modifiers={[listRowBackground(c.paper2)]}
          footer={
            error ? (
              <T modifiers={[font({ size: 12 }), foregroundStyle(c.red)]}>{error}</T>
            ) : undefined
          }
        >
          <TextField
            defaultValue={initialBio}
            placeholder={t("profile.edit.bioPlaceholder")}
            multiline
            numberOfLines={4}
            onChangeText={onChangeBio}
          />
        </Section>
      </Form>
    </Host>
  );
}

/** 自绘回退路径 (Android / Expo Go / 未 rebuild) —— 报刊式表单 + NativeField. */
function FallbackEdit({
  email,
  name,
  bio,
  onChangeName,
  onChangeBio,
  error,
}: {
  email: string;
  name: string;
  bio: string;
  onChangeName: (v: string) => void;
  onChangeBio: (v: string) => void;
  error: string | null;
}) {
  const { t } = useTranslation();
  return (
    <ScrollView
      style={styles.flex}
      contentContainerStyle={styles.scroll}
      keyboardShouldPersistTaps="handled"
    >
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
        {email}
      </Mono>

      <Sans size={11} weight="600" style={styles.label}>
        {t("profile.edit.nameLabel")}
      </Sans>
      <NativeField
        value={name}
        onChangeText={onChangeName}
        placeholder={t("profile.edit.namePlaceholder")}
        autoCapitalize="sentences"
        maxLength={60}
      />

      <Sans size={11} weight="600" style={styles.label}>
        {t("profile.edit.bioLabel")}
      </Sans>
      <NativeField
        value={bio}
        onChangeText={onChangeBio}
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
  );
}

const styles = StyleSheet.create({
  ...formFieldStyles,
  root: { flex: 1, backgroundColor: theme.color.paper },
  nativeHost: { flex: 1, backgroundColor: theme.color.paper },
  avatarBlock: {
    alignItems: "center",
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
  },
  avatarTap: { width: 84, height: 84 },
  avatarBadge: {
    position: "absolute",
    right: -2,
    bottom: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
  },
  avatarCta: {
    marginTop: theme.spacing.sm,
    color: theme.color.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
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
