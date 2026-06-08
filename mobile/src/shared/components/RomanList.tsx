import { View, StyleSheet } from "react-native";
import { Display, Mono, Serif } from "./Text";
import { theme } from "@/core/theme";

const ROMAN = ["I.", "II.", "III.", "IV.", "V.", "VI.", "VII.", "VIII."] as const;

export interface RomanListItem {
  text: string;
  subtext?: string;
}

export interface RomanListProps {
  items: RomanListItem[];
}

/**
 * 罗马数字列表. 承诺书的"退出条件"用这个.
 * 用法保持节制 — 不超过 8 项.
 */
export function RomanList({ items }: RomanListProps) {
  return (
    <View>
      {items.map((item, i) => {
        const roman = ROMAN[i] ?? `${i + 1}.`;
        return (
          <View key={item.text} style={styles.row}>
            <Display size={22} italic style={styles.roman}>
              {roman}
            </Display>
            <View style={styles.content}>
              <Serif size={13.5}>{item.text}</Serif>
              {item.subtext ? (
                <Mono size={10} style={styles.subtext}>
                  {item.subtext}
                </Mono>
              ) : null}
            </View>
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  roman: {
    minWidth: 36,
    color: theme.color.ink,
  },
  content: {
    flex: 1,
  },
  subtext: {
    marginTop: theme.spacing.xs,
    color: theme.color.muted,
  },
});
