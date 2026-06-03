/**
 * 选项行的共享视觉 —— QuestionCard(可答) 与 AnsweredRoundCard(只读) 的选项骨架一致:
 * 同一套容器边框 + dot/square/rank 三种 marker + selected 实心态. 抽出来两处共用,
 * 免得 marker 的尺寸/选中色在两个文件里各改一遍而悄悄漂移.
 *
 * 注意: optionText 的"基础色"两边不同(可答态默认 ink2, 只读态默认灰 muted2), 故不放进
 * 共享样式 —— 各自在本地补 optionText 的 color; 这里只共享 selected 态(都为 ink).
 */
import { StyleSheet } from "react-native";

import { theme } from "@/core/theme";

export const optionStyles = StyleSheet.create({
  option: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingVertical: theme.spacing.md,
    paddingHorizontal: theme.spacing.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    backgroundColor: theme.color.paper2,
    gap: theme.spacing.md,
  },
  optionSelected: {
    borderColor: theme.color.ink,
    borderWidth: 1,
    backgroundColor: theme.color.paper3,
  },
  optionMarker: {
    width: 24,
    alignItems: "center",
    paddingTop: 4,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: theme.color.muted,
  },
  dotSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  square: {
    width: 10,
    height: 10,
    borderWidth: 1.5,
    borderColor: theme.color.muted,
  },
  squareSelected: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  rank: {
    color: theme.color.muted,
  },
  rankSelected: {
    color: theme.color.ink,
    fontWeight: "600",
  },
  optionTextSelected: {
    color: theme.color.ink,
  },
});
