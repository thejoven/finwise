import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { Display, DoubleRule, ModalTopBar, Sans, Serif, TapEffect } from "@/shared/components";
import { UI, MODS, hasNativeUI } from "@/shared/native";
import { theme, useThemeColors } from "@/core/theme";
import { useMutedTags, useUnmuteTag } from "@/features/subscriptions/hooks";
import type { MutedTag } from "@/core/api/subscriptions";

/**
 * 内容偏好 · 二级页面 (从「我」进入) —— 列出被「不感兴趣」累积静音的内容标签,
 * 逐个「取消静音」即可让相关推文重新出现在订阅里 (开发文档 §3 硬二 / §10).
 *
 * 与 profile 主页同款双路渲染: hasNativeUI 用原生 SwiftUI Form (大标题 + 分组列表 + 行内
 * 取消静音按钮); 回退路径 (Android / Expo Go / 未 rebuild) 走自绘报刊式行.
 */
export default function ContentPrefsScreen() {
  const { t } = useTranslation();
  const muted = useMutedTags();
  const { mutate: unmute } = useUnmuteTag();
  const tags = muted.data ?? [];

  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ModalTopBar label={t("profile.contentPrefs.topBar")} />
      {hasNativeUI ? (
        <NativeContentPrefs tags={tags} loading={muted.isLoading} onUnmute={unmute} />
      ) : (
        <FallbackContentPrefs tags={tags} loading={muted.isLoading} onUnmute={unmute} />
      )}
    </SafeAreaView>
  );
}

interface ContentPrefsProps {
  tags: MutedTag[];
  loading: boolean;
  onUnmute: (tag: string) => void;
}

/** 原生 SwiftUI Form 路径 —— 大标题 + 分组列表, 每行 #标签 + 行内「取消静音」描边按钮. */
function NativeContentPrefs({ tags, loading, onUnmute }: ContentPrefsProps) {
  const c = useThemeColors();
  const { t } = useTranslation();

  const { Host, Form, Section, Button, HStack, Spacer, Text: T } = UI!;
  const {
    buttonStyle,
    controlSize,
    foregroundStyle,
    tint,
    listRowBackground,
    listRowInsets,
    listRowSeparator,
    scrollContentBackground,
    font,
  } = MODS!;

  const hint = (
    <T modifiers={[font({ size: 12 }), foregroundStyle(c.muted)]}>
      {t("profile.contentPrefs.hint")}
    </T>
  );

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
            {t("profile.contentPrefs.title")}
          </T>
        </Section>

        <Section modifiers={[listRowBackground(c.paper2)]} footer={hint}>
          {tags.length === 0 ? (
            <T modifiers={[font({ size: 14 }), foregroundStyle(c.muted)]}>
              {loading ? t("subscriptions.empty.loading") : t("profile.contentPrefs.empty")}
            </T>
          ) : (
            tags.map((m) => (
              <HStack key={m.tag} spacing={10}>
                <T modifiers={[font({ size: 15, weight: "medium" }), foregroundStyle(c.ink)]}>
                  #{m.tag}
                </T>
                <Spacer />
                <Button
                  label={t("profile.contentPrefs.unmute")}
                  onPress={() => onUnmute(m.tag)}
                  modifiers={[buttonStyle("bordered"), controlSize("small"), tint(c.red)]}
                />
              </HStack>
            ))
          )}
        </Section>
      </Form>
    </Host>
  );
}

/** 自绘回退路径 (Android / Expo Go / 未 rebuild) —— 报刊式标题 + 标签行 + 取消静音胶囊. */
function FallbackContentPrefs({ tags, loading, onUnmute }: ContentPrefsProps) {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Display size={26} italic style={styles.title}>
        {t("profile.contentPrefs.title")}
      </Display>
      <DoubleRule />
      <Serif size={13} italic style={styles.hint}>
        {t("profile.contentPrefs.hint")}
      </Serif>

      {tags.length === 0 ? (
        <Serif size={13} italic style={styles.empty}>
          {loading ? t("subscriptions.empty.loading") : t("profile.contentPrefs.empty")}
        </Serif>
      ) : (
        <View style={styles.list}>
          {tags.map((m) => (
            <View key={m.tag} style={styles.row}>
              <Sans size={14} weight="500" style={styles.tag} numberOfLines={1}>
                #{m.tag}
              </Sans>
              <TapEffect onPress={() => onUnmute(m.tag)} disableEffect style={styles.unmute}>
                <Sans size={12} weight="600" style={styles.unmuteText}>
                  {t("profile.contentPrefs.unmute")}
                </Sans>
              </TapEffect>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  nativeHost: { flex: 1, backgroundColor: theme.color.paper },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.xxxl,
  },
  title: { marginBottom: theme.spacing.sm },
  hint: {
    color: theme.color.muted,
    marginTop: theme.spacing.md,
    marginBottom: theme.spacing.sm,
  },
  empty: {
    color: theme.color.muted,
    marginTop: theme.spacing.xl,
    lineHeight: 21,
  },
  list: { marginTop: theme.spacing.lg },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
    gap: theme.spacing.md,
  },
  tag: { color: theme.color.ink, flex: 1 },
  unmute: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: 5,
  },
  unmuteText: { color: theme.color.ink2 },
});
