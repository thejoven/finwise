import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Serif } from "@/shared/components";
import { theme } from "@/core/theme";

interface SilenceStampProps {
  /** 今日已经录入的条数 */
  todayCount: number;
}

/**
 * "今日状态 · 沉默 / N 条新记录" — 保留状态感, 去掉无意义期号.
 *
 * 沉默是好状态; 不显示数字角标, 不催促用户.
 */
export function SilenceStamp({ todayCount }: SilenceStampProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.row}>
      <View style={styles.left}>
        <Serif size={11} style={styles.statusLabel}>
          {t("capture.silence.label")}
        </Serif>
      </View>
      <View style={styles.right}>
        {todayCount === 0 ? (
          <>
            <View style={styles.check} />
            <Serif size={12} italic style={styles.silent}>
              {t("capture.silence.silent")}
            </Serif>
          </>
        ) : (
          <Serif size={12} italic style={styles.active}>
            {t("capture.silence.count", { count: todayCount })}
          </Serif>
        )}
      </View>
    </View>
  );
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
  statusLabel: {
    color: theme.color.muted,
    letterSpacing: 1,
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
