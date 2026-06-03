import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { theme } from "@/core/theme";

import { Icon } from "./Icon";
import { Mono } from "./Text";
import { TapEffect } from "./TapEffect";

/**
 * modal 顶栏: 左侧返回箭头 + 居中 Mono 标签 + 右侧等宽占位(让标签真正视觉居中).
 * 改密 / 编辑资料 / 搜索三个 modal 共用. 默认返回上一页, 可传 onBack 覆盖.
 */
export function ModalTopBar({ label, onBack }: { label: string; onBack?: () => void }) {
  return (
    <View style={styles.topBar}>
      <TapEffect style={styles.backBtn} onPress={onBack ?? (() => router.back())}>
        <Icon name="chevronLeft" size={22} color={theme.color.ink} strokeWidth={1.5} />
      </TapEffect>
      <Mono size={10} style={styles.topMeta}>
        {label}
      </Mono>
      <View style={styles.backBtn} />
    </View>
  );
}

const styles = StyleSheet.create({
  topBar: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: theme.spacing.base,
    paddingVertical: theme.spacing.sm,
  },
  backBtn: { width: 32, height: 32, alignItems: "center", justifyContent: "center" },
  topMeta: { color: theme.color.muted, letterSpacing: 2, textTransform: "uppercase" },
});
