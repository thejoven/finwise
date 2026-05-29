import { StyleSheet, View } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";

/**
 * 底部 tab bar 背景: iOS 26+ 用 expo-glass-effect 的 GlassView (liquid glass),
 * iOS 18 及以下 / Android 降级到 expo-blur 的 BlurView (systemChromeMaterial).
 *
 * 用法: 作为 `Tabs` 的 `screenOptions.tabBarBackground` 传入. 配合
 *   `tabBarStyle: { position: "absolute", backgroundColor: "transparent",
 *     borderTopWidth: 0 }` 才能让内容滚到 bar 底下, 毛玻璃效果才出得来.
 *
 * @see https://docs.expo.dev/versions/latest/sdk/glass-effect/
 */
export function GlassTabBarBackground() {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView
        style={StyleSheet.absoluteFill}
        glassEffectStyle="regular"
      />
    );
  }
  return (
    <View style={StyleSheet.absoluteFill}>
      <BlurView
        style={StyleSheet.absoluteFill}
        tint="systemChromeMaterial"
        intensity={80}
      />
    </View>
  );
}
