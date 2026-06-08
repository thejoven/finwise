import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Display, DoubleRule, Mono, Serif } from "@/shared/components";
import { theme } from "@/core/theme";

/**
 * 报纸 tab —— 财知左侧的新栏目, 功能尚未开发 (本轮先占位, 见 GOAL).
 *
 * 视觉沿用报刊感: 大号刊名「报纸」+ italic 副题 + 双横线, 下方居中一段接纳式占位文案
 * (不催促、不放 "敬请期待 😢" 之类). 待功能落地再填内容.
 *
 * 顶部留 safe-area top; 底部留 insets.bottom + 64 给悬浮的灵动岛 tab bar 让位.
 */
export default function NewspaperScreen() {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + theme.spacing.xl }]}>
        <Display size={30}>报纸</Display>
        <Serif size={13} italic style={styles.subtitle}>
          为你精选的财经要闻与深度长读。
        </Serif>
        <View style={styles.rule}>
          <DoubleRule />
        </View>
      </View>

      <View style={[styles.body, { paddingBottom: insets.bottom + 64 }]}>
        <Mono size={10} style={styles.stamp}>
          COMING SOON
        </Mono>
        <Serif size={14} italic style={styles.bodyText}>
          报纸还在排版中。{"\n"}未来这一版会替你把噪音挡在外面，只留下几页值得慢读的内容。
        </Serif>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  subtitle: {
    color: theme.color.muted,
    marginTop: theme.spacing.xs,
  },
  rule: {
    marginTop: theme.spacing.md,
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: theme.spacing.xl,
    gap: theme.spacing.md,
  },
  stamp: {
    color: theme.color.muted2,
    letterSpacing: 2,
  },
  bodyText: {
    color: theme.color.muted,
    textAlign: "center",
  },
});
