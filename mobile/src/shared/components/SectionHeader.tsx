import { View, StyleSheet } from "react-native";
import { Sans, Serif } from "./Text";
import { theme } from "@/core/theme";

export interface SectionHeaderProps {
  label: string;
  meta?: string;
}

/**
 * 报刊风小标题: ♦ 红色 + 全大写小字 label + 右侧斜体 meta.
 * "Conviction Quarterly" 风格中的栏目分隔.
 */
export function SectionHeader({ label, meta }: SectionHeaderProps) {
  return (
    <View style={styles.container}>
      <View style={styles.diamond} />
      <Sans size={10} weight="700" style={styles.label}>
        {label}
      </Sans>
      {meta ? (
        <Serif size={10} italic style={styles.meta}>
          {meta}
        </Serif>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
    alignSelf: "center",
  },
  label: {
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.ink,
  },
  meta: {
    marginLeft: "auto",
    color: theme.color.muted,
  },
});
