import type { ReactNode } from "react";
import { KeyboardAvoidingView, Platform, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { theme } from "@/core/theme";

/**
 * 表单 modal 的外壳 —— 登录 / 注册 / 改密 / 编辑资料 / 搜索都长一样:
 *   SafeAreaView(paper 底, 上下避让安全区) → KeyboardAvoidingView(iOS 上 padding 顶起键盘).
 * 内部内容(topBar / ScrollView / footer 等)由各屏自己摆放.
 */
export function KeyboardForm({ children }: { children: ReactNode }) {
  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        style={styles.flex}
      >
        {children}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  flex: { flex: 1 },
});
