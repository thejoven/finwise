/**
 * InsightBlock — 单次 attention 的"洞察 + 盲点", 报刊摘录风.
 *
 * 视觉:
 *   ◆ 本次洞察                 ← Mono stamp (red diamond)
 *   你这次推演节奏稳, 三阶链条到位, 但视角偏窄...   ← Serif Display 段
 *
 *   ◆ 盲点
 *   下次 R2 多选时至少强制选 3 个不同 lens.        ← Serif italic, muted
 *
 *   ── 完成于 5/28 13:19  R3 RWA 跨域套利        ← Mono 灰底
 */

import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Display, Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  insight: string;
  blindspot: string;
  /** 例 "5/28 13:19" */
  whenLabel?: string;
}

export function InsightBlock({ insight, blindspot, whenLabel }: Props) {
  const { t } = useTranslation();
  return (
    <View style={styles.root}>
      <View style={styles.section}>
        <View style={styles.stampRow}>
          <View style={styles.diamond} />
          <Mono size={9} style={styles.stamp}>
            {t("attention.insight.stamp")}
          </Mono>
        </View>
        <Display size={17} style={styles.insightText}>
          {insight}
        </Display>
      </View>

      <View style={styles.section}>
        <View style={styles.stampRow}>
          <View style={[styles.diamond, styles.diamondMuted]} />
          <Mono size={9} style={styles.stamp}>
            {t("attention.insight.blindspotStamp")}
          </Mono>
        </View>
        <Serif size={14} italic style={styles.blindspotText}>
          {blindspot}
        </Serif>
      </View>

      {whenLabel ? (
        <Mono size={9} style={styles.when}>
          {whenLabel}
        </Mono>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    gap: theme.spacing.md,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.md,
  },
  section: {
    gap: theme.spacing.xs,
  },
  stampRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
  },
  diamondMuted: {
    backgroundColor: theme.color.muted,
  },
  stamp: {
    color: theme.color.muted,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  insightText: {
    color: theme.color.ink,
    lineHeight: 26,
  },
  blindspotText: {
    color: theme.color.ink2,
    lineHeight: 22,
  },
  when: {
    color: theme.color.muted2,
    letterSpacing: 1,
    paddingTop: theme.spacing.xs,
  },
});
