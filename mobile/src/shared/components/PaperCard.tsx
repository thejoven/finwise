import { View, StyleSheet, type ViewProps, type StyleProp, type ViewStyle } from "react-native";
import type { ReactNode } from "react";
import { theme } from "@/core/theme";

export interface PaperCardProps extends Omit<ViewProps, "children" | "style"> {
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

/**
 * 白底 + 1.5px 实边 + 内边距. 承诺书、信号卡的基底.
 */
export function PaperCard({ children, style, ...props }: PaperCardProps) {
  return (
    <View style={[styles.card, style]} {...props}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: theme.color.paper,
    borderWidth: 1.5,
    borderColor: theme.color.ink,
    padding: theme.spacing.base,
  },
});
