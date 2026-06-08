import { Link, Stack } from "expo-router";
import { StyleSheet, View } from "react-native";
import { Display, Serif } from "@/shared/components";
import { theme } from "@/core/theme";

export default function NotFound() {
  return (
    <>
      <Stack.Screen options={{ title: "迷路了" }} />
      <View style={styles.container}>
        <Display size={28} italic>
          走丢了。
        </Display>
        <Serif size={14} italic style={styles.note}>
          这条路径不存在, 或者还没建好。
        </Serif>
        <Link href="/(tabs)/caizhi" style={styles.link}>
          <Serif size={13}>← 回信箱</Serif>
        </Link>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: theme.spacing.xl,
    backgroundColor: theme.color.paper,
    gap: theme.spacing.lg,
  },
  note: {
    color: theme.color.muted,
    textAlign: "center",
  },
  link: {
    marginTop: theme.spacing.lg,
  },
});
