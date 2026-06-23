/**
 * VoiceControl — 录入页的语音输入控件 (表现层, 状态由 useVoiceInput 提供).
 *
 * 三态:
 *   idle        → 麦克风按钮 "语音输入" (右侧可显示上次错误)
 *   recording   → 脉冲红点 + "聆听中…" + 停止
 *   transcribing→ 转圈 + "识别中…" + 取消 (CPU 转写慢, 必须可中断)
 *
 * 反模式留意: 录入"提交"不弹 spinner; 但"识别中"是用户主动等待转写结果, 给克制的内联反馈
 * 是必要的 (不是模态遮罩).
 */
import { useEffect } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";

import { Icon, Sans, Serif, TapEffect } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";

import type { VoiceStatus } from "./useVoiceInput";

interface VoiceControlProps {
  status: VoiceStatus;
  /** i18n key 后缀 (capture.voice.*), 无错误为 null. */
  errorKey: string | null;
  onStart: () => void;
  onStop: () => void;
  onCancel: () => void;
  onDismissError: () => void;
}

export function VoiceControl({
  status,
  errorKey,
  onStart,
  onStop,
  onCancel,
  onDismissError,
}: VoiceControlProps) {
  const { t } = useTranslation();
  // Reanimated 的 Animated.View 不能吃 DynamicColorIOS 动态色对象 (会报 Invalid color value),
  // 故录音点的底色走 useThemeColors() 拿解析后的纯 hex.
  const c = useThemeColors();
  const pulse = useSharedValue(1);

  useEffect(() => {
    if (status === "recording") {
      pulse.value = withRepeat(withTiming(0.25, { duration: 700 }), -1, true);
    } else {
      cancelAnimation(pulse);
      pulse.value = 1;
    }
  }, [status, pulse]);

  const dotStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));

  if (status === "recording") {
    return (
      <View style={styles.row}>
        <View style={styles.live}>
          <Animated.View style={[styles.dot, { backgroundColor: c.red }, dotStyle]} />
          <Serif size={13} italic style={styles.liveLabel}>
            {t("capture.voice.recording")}
          </Serif>
        </View>
        <TapEffect style={styles.action} onPress={onStop}>
          <Icon name="stop" size={14} color={theme.color.red} />
          <Sans size={11} weight="700" style={styles.actionLabel}>
            {t("capture.voice.stop")}
          </Sans>
        </TapEffect>
      </View>
    );
  }

  if (status === "transcribing") {
    return (
      <View style={styles.row}>
        <View style={styles.live}>
          <ActivityIndicator size="small" color={theme.color.muted} />
          <Serif size={13} italic style={styles.liveLabel}>
            {t("capture.voice.transcribing")}
          </Serif>
        </View>
        <TapEffect style={styles.action} onPress={onCancel} disableEffect>
          <Sans size={11} weight="700" style={styles.actionLabelMuted}>
            {t("capture.voice.cancel")}
          </Sans>
        </TapEffect>
      </View>
    );
  }

  // idle
  return (
    <View style={styles.row}>
      <TapEffect
        style={styles.micButton}
        pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        onPress={onStart}
      >
        <Icon name="mic" size={14} color={theme.color.ink2} />
        <Sans size={11} weight="700" style={styles.micLabel}>
          {t("capture.voice.record")}
        </Sans>
      </TapEffect>
      {errorKey ? (
        <TapEffect style={styles.errorWrap} onPress={onDismissError} disableEffect>
          <Serif size={12} italic style={styles.error}>
            {errorKey === "permissionDenied"
              ? t("capture.voice.permissionDenied")
              : t("capture.voice.failed")}
          </Serif>
        </TapEffect>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 34,
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  micButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    borderRadius: theme.radius.none,
  },
  micLabel: {
    color: theme.color.ink2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  live: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 5,
  },
  liveLabel: {
    color: theme.color.muted,
  },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.xs,
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
  },
  actionLabel: {
    color: theme.color.red,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  actionLabelMuted: {
    color: theme.color.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  errorWrap: {
    flexShrink: 1,
  },
  error: {
    color: theme.color.red,
  },
});
