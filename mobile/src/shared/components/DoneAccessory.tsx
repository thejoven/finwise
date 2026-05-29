/**
 * DoneAccessory — iOS 键盘顶部工具栏, 让用户用"完成"按钮主动收键盘.
 *
 * 为什么需要: multiline TextInput 在 iOS 没有"回车 = 收键盘"语义, 用户经常找
 * 不到怎么关. 给个明显的"完成"按钮是 iOS HIG 推荐做法.
 *
 * 用法:
 *   1. 在屏幕最外层挂一次 <DoneAccessory nativeID="refinement-done" />
 *   2. 给所有需要的 TextInput 加 inputAccessoryViewID="refinement-done"
 *
 * Android: 没有 inputAccessoryViewID 概念, 这个组件返 null. Android 上用户用
 * 系统返回键 / 软键盘的隐藏键收键盘.
 *
 * 设计延续报刊感: 顶部 hairline rule + 右对齐 Mono "完成" 按钮, 不引图标.
 */

import { InputAccessoryView, Keyboard, Platform, StyleSheet, View } from "react-native";

import { Mono, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  /** inputAccessoryViewID, TextInput 用这个 id 关联 */
  nativeID: string;
}

export function DoneAccessory({ nativeID }: Props) {
  if (Platform.OS !== "ios") return null;
  return (
    <InputAccessoryView nativeID={nativeID}>
      <View style={styles.bar}>
        <TapEffect onPress={() => Keyboard.dismiss()} style={styles.btn}>
          <Mono size={10} style={styles.label}>
            完成
          </Mono>
        </TapEffect>
      </View>
    </InputAccessoryView>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    justifyContent: "flex-end",
    alignItems: "center",
    backgroundColor: theme.color.paper2,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
  },
  btn: {
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs,
  },
  label: {
    color: theme.color.ink,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
});
