import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { Mono, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import { LIST_LAYOUT } from "@/shared/motion";

import { formatMonthDay } from "@/shared/format";
import type { MergedSignal } from "./hooks";

interface SignalRowProps {
  signal: MergedSignal;
}

export function SignalRow({ signal }: SignalRowProps) {
  // 列表恒按当前分类筛选 (没有"全部"视图), 整列同分类 —— 不再逐行重复显示分类标识.
  return (
    <Animated.View layout={LIST_LAYOUT}>
      <TapEffect onPress={() => router.push(`/signal/${signal.id}`)} style={styles.row}>
        <Mono size={10} style={styles.date}>
          {formatMonthDay(signal.captured_at)}
        </Mono>
        <View style={styles.content}>
          <Serif size={15} style={styles.text} numberOfLines={3}>
            {signal.raw_text}
          </Serif>
          {signal.inference_summary ? (
            <Serif size={12} italic style={styles.summary} numberOfLines={2}>
              {signal.inference_summary}
            </Serif>
          ) : null}
          <SignalStatus signal={signal} />
        </View>
      </TapEffect>
    </Animated.View>
  );
}

function SignalStatus({ signal }: SignalRowProps) {
  const { t } = useTranslation();
  if (signal.local_sync === "exhausted") {
    return (
      <Serif size={10} italic style={styles.statusFailed}>
        {t("capture.status.unsynced")}
      </Serif>
    );
  }
  if (signal.local_sync === "failed") {
    return (
      <Serif size={10} italic style={styles.statusMuted}>
        {t("capture.status.retrying")}
      </Serif>
    );
  }
  if (signal.local_sync === "syncing" || signal.inference_status === "pending") {
    return (
      <Serif size={10} italic style={styles.statusMuted}>
        {t("capture.status.inferring")}
      </Serif>
    );
  }
  if (signal.inference_status === "done") {
    return (
      <Serif size={10} italic style={styles.statusDone}>
        {t("capture.status.inferred")}
      </Serif>
    );
  }
  if (signal.inference_status === "failed") {
    return (
      <Serif size={10} italic style={styles.statusFailed}>
        {t("capture.status.inferFailed")}
      </Serif>
    );
  }
  return null;
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.md,
  },
  date: {
    color: theme.color.muted,
    paddingTop: 4,
    width: 40,
  },
  content: {
    flex: 1,
  },
  text: {
    color: theme.color.ink,
  },
  summary: {
    color: theme.color.muted,
    marginTop: 4,
  },
  statusMuted: {
    color: theme.color.muted,
    marginTop: 6,
    letterSpacing: 0.5,
  },
  statusDone: {
    color: theme.color.green,
    marginTop: 6,
    letterSpacing: 0.5,
  },
  statusFailed: {
    color: theme.color.red,
    marginTop: 6,
    letterSpacing: 0.5,
  },
});
