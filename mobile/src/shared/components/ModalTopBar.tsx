import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { theme } from "@/core/theme";

import { Icon } from "./Icon";
import { Mono, Sans } from "./Text";
import { TapEffect } from "./TapEffect";

/**
 * modal 顶栏: 左侧返回箭头 + 居中 Mono 标签 + 右侧 (可选「保存」动作 / 否则等宽占位让标签居中).
 * 改密 / 编辑资料 / 搜索等 modal 共用. 默认返回上一页, 可传 onBack 覆盖.
 *
 * `action` —— 右上角主动作 (如保存). 放顶栏右上而非底部, 是 iOS modal 的标准编排 (左取消/右完成),
 *   且避开「底部按钮被键盘盖住」: 原生 SwiftUI Form 自带键盘避让, 底部 RN footer 会与之打架被遮.
 *   `disabled` 时变灰且不可点.
 */
export function ModalTopBar({
  label,
  onBack,
  action,
}: {
  label: string;
  onBack?: () => void;
  action?: { label: string; onPress: () => void; disabled?: boolean };
}) {
  return (
    <View style={styles.topBar}>
      <TapEffect style={styles.backBtn} onPress={onBack ?? (() => router.back())}>
        <Icon name="chevronLeft" size={22} color={theme.color.ink} strokeWidth={1.5} />
      </TapEffect>
      <Mono size={10} style={styles.topMeta}>
        {label}
      </Mono>
      {action ? (
        <TapEffect style={styles.actionBtn} onPress={action.onPress} disabled={action.disabled}>
          <Sans
            size={11}
            weight="700"
            style={[styles.actionLabel, action.disabled && styles.actionLabelDim]}
          >
            {action.label}
          </Sans>
        </TapEffect>
      ) : (
        <View style={styles.backBtn} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  topMeta: { color: theme.color.muted, letterSpacing: 2, textTransform: "uppercase" },
  // 右上动作: 等高、右对齐; 无动作时退回等宽占位 (backBtn), 标签仍近似居中.
  actionBtn: {
    minWidth: 32,
    height: 32,
    alignItems: "flex-end",
    justifyContent: "center",
    paddingLeft: theme.spacing.sm,
  },
  actionLabel: {
    color: theme.color.ink,
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  actionLabelDim: { color: theme.color.muted2 },
});
