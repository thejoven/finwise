/**
 * InputTrigger — 长文本输入的触发器, 看起来像 disabled multiline TextInput.
 *
 * 视觉:
 *   - 空时:   "写下你的回答..."  (italic muted)  ↗ (右上)
 *   - 有值时: "你写的前 N 字..."  (Serif ink)    ↗
 *
 * 点击 → 父组件打开 TextInputModal.
 *
 * 为什么不直接 TextInput:
 *   长文本输入在 ScrollView + KAV 内难做到稳定的"键盘不挡". Modal 弹层完全
 *   隔离, 用户聚焦输入, 写完点保存返回.
 */

import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { Icon, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  value: string;
  placeholder: string;
  onPress: () => void;
  /** 显示已填值的前 N 字, 默认 120 */
  preview?: number;
  /** 是否细高样式 — 用 user_input 嵌在选项里时设 small (minHeight 56). 默认 normal (minHeight 96) */
  small?: boolean;
}

export function InputTrigger({ value, placeholder, onPress, preview = 120, small = false }: Props) {
  const { t } = useTranslation();
  const isEmpty = !value || value.trim() === "";
  const display = isEmpty
    ? placeholder
    : value.length <= preview
      ? value
      : value.slice(0, preview) + "…";

  return (
    <TapEffect
      onPress={onPress}
      style={[styles.box, small && styles.boxSmall]}
      pressedStyle={{ backgroundColor: theme.color.paperPressed }}
    >
      <View style={styles.row}>
        <Serif
          size={small ? 13 : 14}
          italic={isEmpty}
          style={[styles.text, isEmpty ? styles.textEmpty : styles.textFilled]}
        >
          {display}
        </Serif>
        <Icon
          name="arrowUpRight"
          size={16}
          color={isEmpty ? theme.color.muted2 : theme.color.ink2}
          strokeWidth={1.5}
          style={styles.arrow}
        />
      </View>
      {!isEmpty ? (
        <Serif size={10} italic style={styles.tapHint}>
          {t("refinement.input.tapToEdit", { count: value.length })}
        </Serif>
      ) : (
        <Serif size={10} italic style={styles.tapHint}>
          {t("refinement.input.tapToExpand")}
        </Serif>
      )}
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  box: {
    minHeight: 96,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    padding: theme.spacing.md,
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  boxSmall: {
    minHeight: 56,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    backgroundColor: theme.color.paper3,
    marginTop: theme.spacing.xs,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.sm,
  },
  text: {
    flex: 1,
    lineHeight: 22,
  },
  textEmpty: {
    color: theme.color.muted2,
  },
  textFilled: {
    color: theme.color.ink,
  },
  arrow: {
    marginTop: 2,
  },
  tapHint: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
});
