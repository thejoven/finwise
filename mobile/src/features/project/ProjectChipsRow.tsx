/**
 * Chip — 单个分类标签 (报刊感的细线胶囊).
 *
 *   - active: ink 填充 + paper 文字
 *   - inactive: paper2 + 细线 + ink 文字 (有 color 时用其作描边)
 *
 * 目前由 capture 的 CategoryPicker 复用. (历史上的 ProjectChipsRow 横滑分类条已下线,
 * 分类切换改走财知报头 HeaderCategoryCell + CategoryDropdown.)
 */

import { StyleSheet } from "react-native";

import { theme } from "@/core/theme";
// 走具体文件而非 "@/shared/components" barrel: 切断 shared ⇄ feature 的 require cycle.
import { Sans } from "@/shared/components/Text";
import { TapEffect } from "@/shared/components/TapEffect";

export interface ChipProps {
  label: string;
  active: boolean;
  color?: string;
  onPress: () => void;
  onLongPress?: () => void;
}

export function Chip({ label, active, color, onPress, onLongPress }: ChipProps) {
  const tinted = !active && color ? { borderColor: color } : null;
  return (
    <TapEffect
      onPress={onPress}
      onLongPress={onLongPress}
      style={[styles.chip, active ? styles.chipActive : styles.chipInactive, tinted]}
    >
      <Sans
        size={11}
        weight={active ? "600" : "500"}
        style={active ? styles.labelActive : styles.labelInactive}
      >
        {label}
      </Sans>
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  chip: {
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: 4,
    minHeight: 24,
    justifyContent: "center",
    alignItems: "center",
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipActive: {
    backgroundColor: theme.color.ink,
    borderColor: theme.color.ink,
  },
  chipInactive: {
    backgroundColor: theme.color.paper2,
    borderColor: theme.color.rule,
  },
  labelActive: {
    color: theme.color.paper,
    letterSpacing: 1,
  },
  labelInactive: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
});
