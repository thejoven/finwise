/**
 * 卷首语 — 品牌简介页 / about.
 *
 * 入口: A1 收件箱 Masthead 左上角 ≡ 菜单.
 *
 * 视觉: 报刊感. 仿照创刊号扉页 —
 *   · 居中报刊头 (中文主名 + 英文副线 + slogan)
 *   · 双横线分隔
 *   · 三段正文 Serif 衬线
 *   · 底部小字刊号
 *
 * 反模式 (按 docs/产品文档/06_产品哲学.md):
 *   · 不放"开始使用"CTA — 用户已经在用了
 *   · 不放进度条 / 引导 swiper
 *   · 不主动弹, 用户主动来看
 */

import { ScrollView, StyleSheet, Text as RNText, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router } from "expo-router";

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
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <View style={styles.topBar}>
        <TapEffect onPress={() => router.back()} style={styles.backBtn}>
          <Icon name="chevronLeft" size={22} color={theme.color.ink} strokeWidth={1.5} />
        </TapEffect>
        <Mono size={10} style={styles.topMeta}>
          卷首语 · COLOPHON
        </Mono>
        <View style={styles.backBtn} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.masthead}>
          <RNText allowFontScaling={false} style={styles.nameplateCJK}>
            财知
          </RNText>
          <Display size={18} italic style={styles.nameplateEN}>
            WiseFlow
          </Display>
        </View>

        <DoubleRule />

        <View style={styles.sloganBlock}>
          <RNText maxFontSizeMultiplier={1.2} style={styles.sloganZh}>
            以智驭财 · 行远致富
          </RNText>
          <Serif size={11} italic style={styles.sloganEn}>
            Master money. Master your future.
          </Serif>
        </View>

        <DoubleRule />

        <View style={styles.body}>
          <Serif size={14} style={styles.lede}>
            财知是一款<RNText style={styles.bodyBold}>不打扰你</RNText>的 AI 财富伙伴。
          </Serif>

          <Serif size={14} style={styles.para}>
            它不追每日行情、不堆砌资讯，而是帮你把模糊的市场直觉，淬炼成少数几个高确定性的投资承诺。
          </Serif>

          <View style={styles.pullQuoteWrap}>
            <View style={styles.pullRule} />
            <Serif size={16} italic style={styles.pullQuote}>
              少一点决策，{"\n"}多一份信念。
            </Serif>
            <View style={styles.pullRule} />
          </View>
        </View>

        <DoubleRule />

        <View style={styles.debtBlock}>
          <SectionHeader label="认知的债务" meta="COGNITIVE DEBT" />

          <Serif size={14} style={styles.debtIntro}>
            市面上的 AI，都在比谁更快替你给出答案。你越贪图这种捷径，越在不知不觉中欠下一笔
            <RNText style={styles.bodyBold}>“认知债务”</RNText>
            ——被代劳的每一个判断，都是大脑本该变强、却被你跳过的一次机会。
          </Serif>

          <Serif size={14} style={styles.debtPara}>
            财知反其道而行。它从不替你思考，只把问题一次次还给你——每一次信号都是大脑变强的机会，每一轮追问都是一次
            <RNText style={styles.bodyBold}>思考的乐趣</RNText>
            ，一段只属于你的创作。
          </Serif>

          <View style={styles.pullQuoteWrap}>
            <View style={styles.pullRule} />
            <Serif size={16} italic style={styles.pullQuote}>
              别人用 AI 代替思考，{"\n"}
              你用财知练习思考。
            </Serif>
            <View style={styles.pullRule} />
          </View>
        </View>

        <DoubleRule />

        <View style={styles.compoundBlock}>
          <SectionHeader label="复利的认知" meta="COMPOUNDING COGNITION" />

          <Serif size={14} style={styles.compoundIntro}>
            财知不是一个让你"赚更多"的工具，而是一套通过五个动作循环不断打磨的
            <RNText style={styles.bodyBold}>财商认知系统</RNText>。
          </Serif>

          <Serif size={13} italic style={styles.compoundIntroSub}>
            每一次完整的录入、追问、过会、签字、复盘，都是一笔本金；时间会替你把它们利上滚利。
          </Serif>

          <View style={styles.compoundList}>
            <RomanList
              items={[
                {
                  text: "观察 — 每写下一条信号，是一次注意力的训练。",
                  subtext: "PHASE 1 · 安静",
                },
                {
                  text: "推理 — 每答完五轮追问，是一次结构化思考的训练。",
                  subtext: "PHASE 2 · 仪式",
                },
                {
                  text: "纪律 — 每一次过会，是一次能力圈的校准。",
                  subtext: "PHASE 2 · 仪式",
                },
                {
                  text: "承诺 — 每签一份承诺书，是一次预决定的训练。",
                  subtext: "PHASE 2 · 仪式",
                },
                {
                  text: "自省 — 每完成一次复盘，是一次照见自己的训练。",
                  subtext: "PHASE 3 · 镜子",
                },
              ]}
            />
          </View>

          <View style={styles.compoundCloseWrap}>
            <View style={styles.pullRule} />
            <Serif size={14} italic style={styles.compoundClose}>
              财富的复利来自资本，{"\n"}
              认知的复利来自次数。
            </Serif>
            <View style={styles.pullRule} />
            <Serif size={13} style={styles.compoundCloseBody}>
              一年之后，你不只是赚到了钱 ——
              你建立了一套不会被市场情绪裹挟的判断系统。这套系统会跟着你的下一笔投资、下一个十年，持续复利。
            </Serif>
          </View>
        </View>

        <View style={styles.footer}>
          <Mono size={9} style={styles.footMeta}>
            VOL. I · 创刊号
          </Mono>
          <Mono size={9} style={styles.footMeta}>
            WISEFLOW · 财知大道
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
