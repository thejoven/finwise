import { View, type ColorValue } from "react-native";
import { theme } from "@/core/theme";

export interface DoubleRuleProps {
  thickness?: number;
  color?: ColorValue;
  gap?: number;
}

/**
 * 双横线. 报刊感的核心装饰.
 * 默认 1px + 2px gap + 1px (黑色, paperPressed 背景上对比清晰).
 */
export function DoubleRule({ thickness = 1, color = theme.color.ink, gap = 2 }: DoubleRuleProps) {
  return (
    <View style={{ paddingVertical: 2 }}>
      <View style={{ height: thickness, backgroundColor: color }} />
      <View style={{ height: gap }} />
      <View style={{ height: thickness, backgroundColor: color }} />
    </View>
  );
}
