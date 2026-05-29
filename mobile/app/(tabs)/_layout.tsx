import { Tabs } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import { Text } from "react-native";

import { GlassTabBarBackground } from "@/shared/components";
import { theme } from "@/core/theme";

/**
 * 底部 Tab: 收件箱 · 档案 · 统计 · 我.
 *
 * 背景走 expo-glass-effect:
 *   · iOS 26+ 用 GlassView (liquid glass)
 *   · iOS 18 及以下 fallback 到 expo-blur 的 BlurView (systemChromeMaterial)
 *   · 见 `GlassTabBarBackground`.
 *
 * 之前是 `NativeTabs` (UITabBarController), 切到 expo-router 的 `Tabs`
 *   (React Navigation 的 BottomTabs) 是为了能显式控制 tabBarBackground.
 *   代价: 失去 NativeTabs 的 minimizeBehavior (滚动收起) 和 iOS 26 自动适配,
 *   但拿到了对 glass 视觉的完全控制权.
 *
 * 图标用 `expo-symbols/SymbolView` 继续走 SF Symbol; Android 自动 fallback 到
 *   `fallback` 节点 (这里没传, 会渲染空 — 当前阶段只跑 iOS).
 *
 * 关于 paddingBottom: tabBarStyle 设了 position: "absolute" 让 glass 浮在内容
 *   之上, 所以各 tab 屏幕仍需手动给 ScrollView 留 `insets.bottom + 64` 的
 *   底部内边距 (跟 NativeTabs 时代一样, 见 inbox.tsx / archive.tsx).
 *
 * @see https://docs.expo.dev/versions/latest/sdk/glass-effect/
 * @see https://reactnavigation.org/docs/bottom-tab-navigator
 */
export const unstable_settings = {
  initialRouteName: "inbox",
};

type TabIcon = { default: SFSymbol; selected: SFSymbol };

function makeIcon(symbols: TabIcon) {
  return ({ focused, color, size }: { focused: boolean; color: string; size: number }) => (
    <SymbolView
      name={focused ? symbols.selected : symbols.default}
      size={size}
      tintColor={color}
      resizeMode="scaleAspectFit"
    />
  );
}

function makeLabel(label: string) {
  return ({ focused, color }: { focused: boolean; color: string }) => (
    <Text
      style={{
        fontFamily: focused ? theme.fontFamily.cjkBold : theme.fontFamily.cjkRegular,
        fontSize: 10,
        color,
      }}
    >
      {label}
    </Text>
  );
}

export default function TabLayout() {
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarBackground: () => <GlassTabBarBackground />,
        tabBarStyle: {
          position: "absolute",
          backgroundColor: "transparent",
          borderTopWidth: 0,
          elevation: 0,
        },
        tabBarActiveTintColor: theme.color.ink,
        tabBarInactiveTintColor: theme.color.muted,
      }}
    >
      <Tabs.Screen
        name="inbox"
        options={{
          tabBarIcon: makeIcon({ default: "tray", selected: "tray.fill" }),
          tabBarLabel: makeLabel("收件箱"),
        }}
      />
      <Tabs.Screen
        name="archive"
        options={{
          tabBarIcon: makeIcon({ default: "archivebox", selected: "archivebox.fill" }),
          tabBarLabel: makeLabel("档案"),
        }}
      />
      <Tabs.Screen
        name="attention"
        options={{
          tabBarIcon: makeIcon({
            default: "chart.line.uptrend.xyaxis",
            selected: "chart.line.uptrend.xyaxis",
          }),
          tabBarLabel: makeLabel("统计"),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          tabBarIcon: makeIcon({ default: "person", selected: "person.fill" }),
          tabBarLabel: makeLabel("我"),
        }}
      />
    </Tabs>
  );
}
