/**
 * 表单字段的共享样式 —— 登录 / 注册 / 改密 / 编辑资料四屏共用.
 *
 * 这些键历史上在四个文件里逐字节重复了一遍, 改一处容易漏改另外三处而漂移. 现收口到此:
 * 各屏在自己的 StyleSheet.create 里 `...formFieldStyles` 展开即可 —— JSX 仍照常用
 * styles.label / styles.input / styles.signButton, 不必改动. 各屏自己的布局键
 * (scroll / body / title / hint / footer 等)继续留在本地.
 *
 * 外壳见 @/shared/components/KeyboardForm, 顶栏见 ModalTopBar.
 */
import { StyleSheet, type TextStyle, type ViewStyle } from "react-native";

import { theme } from "@/core/theme";

const label: TextStyle = {
  color: theme.color.muted,
  letterSpacing: 1.5,
  textTransform: "uppercase",
  marginBottom: theme.spacing.xs,
  marginTop: theme.spacing.md,
};

const input: TextStyle = {
  fontFamily: theme.fontFamily.serifRegular,
  fontSize: 16,
  lineHeight: 24,
  color: theme.color.ink,
  paddingVertical: theme.spacing.sm,
  borderBottomWidth: StyleSheet.hairlineWidth,
  borderBottomColor: theme.color.rule,
};

const signButton: ViewStyle = {
  backgroundColor: theme.color.ink,
  borderRadius: theme.radius.none,
  paddingVertical: theme.spacing.md,
  alignItems: "center",
};

const signButtonDim: ViewStyle = { backgroundColor: theme.color.muted2 };

const signLabel: TextStyle = {
  color: theme.color.paper,
  letterSpacing: 2,
  textTransform: "uppercase",
};

const error: TextStyle = { color: theme.color.red, marginTop: theme.spacing.lg };

/** 展开进各屏: `StyleSheet.create({ ...formFieldStyles, ...本地布局键 })`. */
export const formFieldStyles = { label, input, signButton, signButtonDim, signLabel, error };
