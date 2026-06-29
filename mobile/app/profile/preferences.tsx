import { ScrollView, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  ModalTopBar,
  SectionHeader,
  Serif,
  TapEffect,
} from "@/shared/components";
import { UI, MODS, hasNativeUI } from "@/shared/native";
import { theme, useThemeColors } from "@/core/theme";
import { useAppearance, type AppearancePref } from "@/core/theme/store";
import { useLanguage, LANGUAGE_ENDONYMS, type LanguagePref } from "@/core/i18n";

/**
 * 偏好设置 · 二级页面 (从「我」→「偏好」进入) —— 外观 + 语言两个选择器.
 *
 * 与 profile 主页同款双路渲染: hasNativeUI 用原生 SwiftUI Form 的 menu Picker; 回退路径用
 * 自绘行 + 红菱形选中点. 选项逻辑原先内联在 profile, 现集中托管在本二级页, 让主页只留导航入口.
 */

const APPEARANCE_KEYS = ["light", "dark", "system"] as const satisfies readonly AppearancePref[];
const LANGUAGE_KEYS = [
  "system",
  "zh-Hans",
  "zh-Hant",
  "en",
] as const satisfies readonly LanguagePref[];

/** 语言行/选项的展示名: system 走翻译, 具体语言用本族写法(endonym). */
function languageLabel(key: LanguagePref, systemLabel: string): string {
  return key === "system" ? systemLabel : LANGUAGE_ENDONYMS[key];
}

export default function PreferencesScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.root} edges={["top"]}>
      <ModalTopBar label={t("profile.preferences.topBar")} />
      {hasNativeUI ? <NativePreferences /> : <FallbackPreferences />}
    </SafeAreaView>
  );
}

/** 原生 SwiftUI Form 路径 —— 原生大标题 + 原生分组选择器, 整页一棵树自带滚动. */
function NativePreferences() {
  const c = useThemeColors();
  const { t } = useTranslation();
  const pref = useAppearance((s) => s.pref);
  const setPref = useAppearance((s) => s.setAppearance);
  const langPref = useLanguage((s) => s.pref);
  const setLang = useLanguage((s) => s.setLanguage);

  const { Host, Form, Section, Picker, Text: T } = UI!;
  const {
    pickerStyle,
    tag,
    listRowBackground,
    listRowInsets,
    listRowSeparator,
    scrollContentBackground,
    font,
    foregroundStyle,
    tint,
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
            {t("profile.preferences.title")}
          </T>
        </Section>

        <Section
          modifiers={[listRowBackground(c.paper2)]}
          footer={
            <T modifiers={[font({ size: 12 }), foregroundStyle(c.muted)]}>
              {t("settings.language.footer")}
            </T>
          }
        >
          <Picker
            label={t("settings.appearance.title")}
            selection={pref}
            onSelectionChange={(value) => void setPref(value as AppearancePref)}
            modifiers={[pickerStyle("menu")]}
          >
            {APPEARANCE_KEYS.map((k) => (
              <T key={k} modifiers={[tag(k)]}>
                {t(`settings.appearance.${k}`)}
              </T>
            ))}
          </Picker>
          <Picker
            label={t("settings.language.title")}
            selection={langPref}
            onSelectionChange={(value) => void setLang(value as LanguagePref)}
            modifiers={[pickerStyle("menu")]}
          >
            {LANGUAGE_KEYS.map((k) => (
              <T key={k} modifiers={[tag(k)]}>
                {languageLabel(k, t("settings.language.system"))}
              </T>
            ))}
          </Picker>
        </Section>
      </Form>
    </Host>
  );
}

/** 自绘回退路径 (Android / Expo Go / 未 rebuild) —— 与原生同样两组选择器. */
function FallbackPreferences() {
  const { t } = useTranslation();
  return (
    <ScrollView contentContainerStyle={styles.scroll}>
      <Display size={26} italic style={styles.title}>
        {t("profile.preferences.title")}
      </Display>
      <DoubleRule />
      <Serif size={13} italic style={styles.hint}>
        {t("settings.language.footer")}
      </Serif>
      <View style={styles.section}>
        <SectionHeader label={t("settings.appearance.title")} />
        <AppearanceRows />
      </View>
      <View style={styles.section}>
        <SectionHeader label={t("settings.language.title")} />
        <LanguageRows />
      </View>
    </ScrollView>
  );
}

/** 外观选择器 (自绘回退) — 光亮 / 暗黑 / 跟随系统, 各一行带红菱形选中点. */
function AppearanceRows() {
  const { t } = useTranslation();
  const pref = useAppearance((s) => s.pref);
  const setPref = useAppearance((s) => s.setAppearance);
  return (
    <>
      {APPEARANCE_KEYS.map((k) => (
        <TapEffect
          key={k}
          style={styles.row}
          onPress={() => void setPref(k)}
          pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        >
          <Serif size={14} style={styles.rowLabel}>
            {t(`settings.appearance.${k}`)}
          </Serif>
          {pref === k ? <View style={styles.badgeDot} /> : null}
        </TapEffect>
      ))}
    </>
  );
}

/** 语言选择器 (自绘回退) — 跟随系统 / 简体 / 繁体 / English. */
function LanguageRows() {
  const { t } = useTranslation();
  const pref = useLanguage((s) => s.pref);
  const setLang = useLanguage((s) => s.setLanguage);
  return (
    <>
      {LANGUAGE_KEYS.map((k) => (
        <TapEffect
          key={k}
          style={styles.row}
          onPress={() => void setLang(k)}
          pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        >
          <Serif size={14} style={styles.rowLabel}>
            {languageLabel(k, t("settings.language.system"))}
          </Serif>
          {pref === k ? <View style={styles.badgeDot} /> : null}
        </TapEffect>
      ))}
    </>
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
  section: { marginTop: theme.spacing.xl },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  rowLabel: { color: theme.color.ink },
  badgeDot: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
  },
});
