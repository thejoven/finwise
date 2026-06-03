import { StyleSheet, Text as RNText, View } from "react-native";

import { Icon } from "./Icon";
import { Display, Sans } from "./Text";
import { TapEffect } from "./TapEffect";
import { theme } from "@/core/theme";
import { ProjectChipsRow } from "@/features/project";

export interface MastheadProps {
  /** 卷号, e.g. "I" */
  volume: string;
  /** 期号, e.g. "1" */
  edition: string;
  /** 日期/周次标签, e.g. "W1" or "01.08" */
  date: string;
  /** 周几 / 副标签, e.g. "开始" */
  weekday: string;
  /** 点击左上角 ≡ → 卷首语 / 设置 */
  onMenuPress?: () => void;
  /**
   * 点击右上角 ＋ → 打开 capture modal.
   *
   * 历史: 这里曾经是 ⌕ Search icon (Phase 1 no-op 占位). 改用 NativeTabs 之后
   * 底部 + tab 被去掉 (UITabBarController 无法拦截 tabPress), 录入入口收到这里.
   */
  onCapturePress?: () => void;
}

/**
 * 报刊头. A1 收件箱顶部 + 档案页顶部都用这个组件.
 *
 * 三层:
 *   1. 顶条: ≡ ... VOL · NO · 日期 · 周几 ... ＋
 *      左 ≡ → 卷首语 (onMenuPress); 右 ＋ → 录入 modal (onCapturePress).
 *   2. 主名 "财知" (NotoSerifSC Bold 大字) + 副线 "FinWise" (Playfair Italic)
 *      + tagline "以智驭财，行远致富"
 *   3. 底部双横线 (原型 v4: `border-bottom: 4px double` → 用两条 hairline 实现)
 *
 * 字体例外: 主名"财知"直接用 RNText + NotoSerifSC, 不走 Display 组件 ——
 * Display 是 Playfair Display 西文族, 中文会 fallback 到系统字体, 失去报刊感.
 */
export function Masthead({
  volume,
  edition,
  date,
  weekday,
  onMenuPress,
  onCapturePress,
}: MastheadProps) {
  return (
    <View>
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TapEffect
            onPress={onMenuPress}
            style={styles.iconButton}
            disabled={!onMenuPress}
            disableEffect={!onMenuPress}
            accessibilityLabel="卷首语 · 关于本刊"
          >
            <Icon
              name="book"
              size={18}
              color={onMenuPress ? theme.color.ink : theme.color.muted2}
              strokeWidth={1.5}
            />
          </TapEffect>
          <Sans size={9} weight="600" style={styles.topStrip}>
            VOL. {volume} · NO. {edition} · {date} · {weekday}
          </Sans>
          <TapEffect
            onPress={onCapturePress}
            style={styles.iconButton}
            disabled={!onCapturePress}
            disableEffect={!onCapturePress}
            accessibilityLabel="记录新观察"
          >
            <Icon
              name="plus"
              size={20}
              color={onCapturePress ? theme.color.ink : theme.color.muted2}
              strokeWidth={1.75}
            />
          </TapEffect>
        </View>
        <RNText allowFontScaling={false} style={styles.nameplateCJK}>
          财知
        </RNText>
        <Display size={14} italic style={styles.subline}>
          FinWise
        </Display>
        <RNText maxFontSizeMultiplier={1.2} style={styles.tagline}>
          以智驭财 · 行远致富
        </RNText>
      </View>
      <ProjectChipsRow parentPadded />
      <DoubleRuleBottom />
    </View>
  );
}

/** 报刊感双横线 — 两条 hairline 之间留 2px 间隙. */
function DoubleRuleBottom() {
  return (
    <View>
      <View style={styles.rule} />
      <View style={styles.ruleGap} />
      <View style={styles.rule} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.color.paper,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: theme.spacing.xs,
  },
  iconButton: {
    width: 28,
    height: 28,
    alignItems: "center",
    justifyContent: "center",
  },
  topStrip: {
    flex: 1,
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.muted,
    textAlign: "center",
  },
  nameplateCJK: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 42,
    lineHeight: 48,
    color: theme.color.ink,
    textAlign: "center",
    letterSpacing: 6,
    marginBottom: 2,
    // CJK 没有 italic, 用字距撑出报刊感
    paddingLeft: 6, // 抵消尾部 letterSpacing 让视觉居中
  },
  subline: {
    textAlign: "center",
    color: theme.color.ink2,
    letterSpacing: 2,
    marginBottom: 6,
  },
  tagline: {
    fontFamily: theme.fontFamily.cjkRegular,
    fontSize: 11,
    lineHeight: 16,
    color: theme.color.muted,
    textAlign: "center",
    letterSpacing: 3,
  },
  rule: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ink,
  },
  ruleGap: {
    height: 2,
  },
});
