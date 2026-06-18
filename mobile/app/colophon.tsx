/**
 * 卷首语 — 品牌简介页 / about.
 *
 * 入口: A1 收件箱 Masthead 左上角 ≡ 菜单.
 *
 * 视觉: 报刊感. 仿照创刊号扉页 —
 *   · 居中报刊头 (中文主名 + 英文副线 + slogan)
 *   · 双横线分隔
 *   · 三段正文 Serif 衬线
 *   · 底部小字
 *
 * 反模式 (按 docs/产品文档/06_产品哲学.md):
 *   · 不放"开始使用"CTA — 用户已经在用了
 *   · 不放进度条 / 引导 swiper
 *   · 不主动弹, 用户主动来看
 */

import { ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  RomanList,
  SectionHeader,
  Serif,
  TapEffect,
} from "@/shared/components";
import { theme } from "@/core/theme";

export default function ColophonScreen() {
  const { t } = useTranslation();
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TapEffect onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="chevronLeft" size={22} color={theme.color.ink} strokeWidth={1.5} />
        </TapEffect>
        <Mono size={10} style={styles.topMeta}>
          {t("components.colophon.navTitle")}
        </Mono>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.masthead}>
          <RNText allowFontScaling={false} style={styles.nameplateCJK}>
            财知
          </RNText>
          <Display size={18} italic style={styles.nameplateEN}>
            AlphaX
          </Display>
        </View>

        <DoubleRule />

        <View style={styles.sloganBlock}>
          <RNText maxFontSizeMultiplier={1.2} style={styles.sloganZh}>
            {t("components.colophon.tagline")}
          </RNText>
          <Serif size={11} italic style={styles.sloganEn}>
            {t("components.colophon.taglineEn")}
          </Serif>
        </View>

        <DoubleRule />

        <View style={styles.body}>
          <Serif size={14} style={styles.lede}>
            {t("components.colophon.lede.pre")}
            <RNText style={styles.bodyBold}>{t("components.colophon.lede.emphasis")}</RNText>
            {t("components.colophon.lede.post")}
          </Serif>

          <Serif size={14} style={styles.para}>
            {t("components.colophon.intro")}
          </Serif>

          <View style={styles.pullQuoteWrap}>
            <View style={styles.pullRule} />
            <Serif size={16} italic style={styles.pullQuote}>
              {t("components.colophon.introPull")}
            </Serif>
            <View style={styles.pullRule} />
          </View>
        </View>

        <DoubleRule />

        <View style={styles.debtBlock}>
          <SectionHeader
            label={t("components.colophon.debt.label")}
            meta={t("components.colophon.debt.meta")}
          />

          <Serif size={14} style={styles.debtIntro}>
            {t("components.colophon.debt.intro.pre")}
            <RNText style={styles.bodyBold}>{t("components.colophon.debt.intro.emphasis")}</RNText>
            {t("components.colophon.debt.intro.post")}
          </Serif>

          <Serif size={14} style={styles.debtPara}>
            {t("components.colophon.debt.para.pre")}
            <RNText style={styles.bodyBold}>{t("components.colophon.debt.para.emphasis")}</RNText>
            {t("components.colophon.debt.para.post")}
          </Serif>

          <View style={styles.pullQuoteWrap}>
            <View style={styles.pullRule} />
            <Serif size={16} italic style={styles.pullQuote}>
              {t("components.colophon.debt.pull")}
            </Serif>
            <View style={styles.pullRule} />
          </View>
        </View>

        <DoubleRule />

        <View style={styles.compoundBlock}>
          <SectionHeader
            label={t("components.colophon.compound.label")}
            meta={t("components.colophon.compound.meta")}
          />

          <Serif size={14} style={styles.compoundIntro}>
            {t("components.colophon.compound.intro.pre")}
            <RNText style={styles.bodyBold}>
              {t("components.colophon.compound.intro.emphasis")}
            </RNText>
            {t("components.colophon.compound.intro.post")}
          </Serif>

          <Serif size={13} italic style={styles.compoundIntroSub}>
            {t("components.colophon.compound.introSub")}
          </Serif>

          <View style={styles.compoundList}>
            <RomanList
              items={[
                {
                  text: t("components.colophon.compound.items.observe.text"),
                  subtext: t("components.colophon.compound.items.observe.subtext"),
                },
                {
                  text: t("components.colophon.compound.items.reason.text"),
                  subtext: t("components.colophon.compound.items.reason.subtext"),
                },
                {
                  text: t("components.colophon.compound.items.discipline.text"),
                  subtext: t("components.colophon.compound.items.discipline.subtext"),
                },
                {
                  text: t("components.colophon.compound.items.commit.text"),
                  subtext: t("components.colophon.compound.items.commit.subtext"),
                },
                {
                  text: t("components.colophon.compound.items.reflect.text"),
                  subtext: t("components.colophon.compound.items.reflect.subtext"),
                },
              ]}
            />
          </View>

          <View style={styles.compoundCloseWrap}>
            <View style={styles.pullRule} />
            <Serif size={14} italic style={styles.compoundClose}>
              {t("components.colophon.compound.close")}
            </Serif>
            <View style={styles.pullRule} />
            <Serif size={13} style={styles.compoundCloseBody}>
              {t("components.colophon.compound.closeBody")}
            </Serif>
          </View>
        </View>

        <View style={styles.footer}>
          <Mono size={9} style={styles.footMeta}>
            {t("components.colophon.footerIssue")}
          </Mono>
          <Mono size={9} style={styles.footMeta}>
            {t("components.colophon.footerColophon")}
          </Mono>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
  },
  backBtn: {
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
  },
  topMeta: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.xxl,
  },

  // 报刊头
  masthead: {
    alignItems: "center",
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.md,
  },
  nameplateCJK: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 64,
    lineHeight: 72,
    color: theme.color.ink,
    letterSpacing: 10,
    paddingLeft: 10, // 抵消尾部 letterSpacing 视觉居中
  },
  nameplateEN: {
    marginTop: theme.spacing.xs,
    letterSpacing: 4,
    color: theme.color.ink2,
  },

  // Slogan
  sloganBlock: {
    alignItems: "center",
    paddingVertical: theme.spacing.lg,
    gap: theme.spacing.xs,
  },
  sloganZh: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 18,
    lineHeight: 28,
    color: theme.color.ink,
    letterSpacing: 4,
    textAlign: "center",
  },
  sloganEn: {
    color: theme.color.muted,
    letterSpacing: 1.5,
    textAlign: "center",
  },

  // 正文
  body: {
    paddingTop: theme.spacing.xl,
    gap: theme.spacing.base,
  },
  lede: {
    color: theme.color.ink2,
    lineHeight: 26,
    fontSize: 15,
  },
  bodyBold: {
    fontFamily: theme.fontFamily.cjkBold,
    color: theme.color.ink,
  },
  para: {
    color: theme.color.ink2,
    lineHeight: 26,
    fontSize: 15,
  },

  // 认知债务 section
  debtBlock: {
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  debtIntro: {
    color: theme.color.ink2,
    lineHeight: 24,
    fontSize: 14,
    marginTop: theme.spacing.sm,
  },
  debtPara: {
    color: theme.color.ink2,
    lineHeight: 24,
    fontSize: 14,
    marginTop: theme.spacing.base,
  },

  // 复利认知 section
  compoundBlock: {
    paddingTop: theme.spacing.xl,
    paddingBottom: theme.spacing.lg,
  },
  compoundIntro: {
    color: theme.color.ink2,
    lineHeight: 24,
    fontSize: 14,
    marginTop: theme.spacing.sm,
  },
  compoundIntroSub: {
    color: theme.color.muted,
    lineHeight: 20,
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.lg,
  },
  compoundList: {
    marginTop: theme.spacing.sm,
    marginBottom: theme.spacing.md,
  },
  compoundCloseWrap: {
    alignItems: "center",
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  compoundClose: {
    color: theme.color.ink,
    textAlign: "center",
    lineHeight: 24,
    letterSpacing: 1,
  },
  compoundCloseBody: {
    color: theme.color.muted,
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: theme.spacing.sm,
    marginTop: theme.spacing.xs,
  },

  // Pull quote
  pullQuoteWrap: {
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.xl,
  },
  pullRule: {
    width: 40,
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ink,
  },
  pullQuote: {
    color: theme.color.ink,
    textAlign: "center",
    lineHeight: 28,
    letterSpacing: 1,
  },

  // 底部
  footer: {
    alignItems: "center",
    marginTop: theme.spacing.xl,
    paddingTop: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
    gap: theme.spacing.xs,
  },
  footMeta: {
    color: theme.color.muted2,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
