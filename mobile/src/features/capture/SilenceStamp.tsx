import { StyleSheet, View } from "react-native";

import { Serif } from "@/shared/components";
import { theme } from "@/core/theme";

interface SilenceStampProps {
  /** 今日已经录入的条数 */
  todayCount: number;
  /** 本年第几期 (从 1 开始). 默认按当前 ISO 周序号. */
  edition?: number;
}

/**
 * "本年第 N 期 · 今日: 沉默 / N 条新记录" — 报刊式状态戳, 接纳, 不催促.
 *
 * 沉默是好状态; 不显示数字角标, 不催促用户.
 */
export function SilenceStamp({ todayCount, edition }: SilenceStampProps) {
  const issueNumber = edition ?? currentIsoWeek();
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Serif size={11} style={styles.editionLabel}>
          本年第{" "}
          <Serif size={11} weight="semibold" style={styles.editionNum}>
            {issueNumber}
          </Serif>{" "}
          期
        </Serif>
      </View>
      <View style={styles.right}>
        {todayCount === 0 ? (
          <>
            <View style={styles.check} />
            <Serif size={12} italic style={styles.silent}>
              今日: 沉默
            </Serif>
          </>
        ) : (
          <Serif size={12} italic style={styles.active}>
            今日: {todayCount} 条新记录
          </Serif>
        )}
      </View>
    </View>
  );
}

/** ISO 8601 week-of-year. 本地时区. */
function currentIsoWeek(d: Date = new Date()): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  // ISO week starts Monday; Thursday is in the iso year
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    paddingBottom: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  left: {
    flexDirection: "row",
    alignItems: "center",
  },
  right: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  editionLabel: {
    color: theme.color.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  editionNum: {
    color: theme.color.ink,
  },
  check: {
    width: 12,
    height: 12,
    borderRadius: 6,
    borderWidth: 1.5,
    borderColor: theme.color.green,
  },
  silent: {
    color: theme.color.green,
  },
  active: {
    color: theme.color.ink2,
  },
});
