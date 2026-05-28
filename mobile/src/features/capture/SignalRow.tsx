import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { Mono, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

import { formatMonthDay } from "./format";
import type { MergedSignal } from "./hooks";

interface SignalRowProps {
  signal: MergedSignal;
}

export function SignalRow({ signal }: SignalRowProps) {
  return (
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
  );
}

function SignalStatus({ signal }: SignalRowProps) {
  if (signal.local_sync === "exhausted") {
    return (
      <Serif size={10} italic style={styles.statusFailed}>
        ◆ 未同步 · 点开重试
      </Serif>
    );
  }
  if (signal.local_sync === "failed") {
    return (
      <Serif size={10} italic style={styles.statusMuted}>
        ◆ 重试中
      </Serif>
    );
  }
  if (signal.local_sync === "syncing" || signal.inference_status === "pending") {
    return (
      <Serif size={10} italic style={styles.statusMuted}>
        ◆ AI 推演中
      </Serif>
    );
  }
  if (signal.inference_status === "done") {
    return (
      <Serif size={10} italic style={styles.statusDone}>
        ◆ AI 已推演
      </Serif>
    );
  }
  if (signal.inference_status === "failed") {
    return (
      <Serif size={10} italic style={styles.statusFailed}>
        ◆ 推演失败
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
