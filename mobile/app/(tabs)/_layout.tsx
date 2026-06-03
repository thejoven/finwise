import { Tabs } from "expo-router";

import { DynamicIslandTabBar } from "@/shared/components";

/**
 * 底部 Tab: 收件箱 · 降噪 · 档案 · 统计 · 我.
 *
 * 视觉走"灵动岛"风格 —— 一颗悬浮的墨色胶囊, 选中项展开露出标签, 切换时灵巧伸缩.
 *   整套图标 / 标签 / 配色 / 动画都在 `DynamicIslandTabBar` 里定义, 本文件只声明
 *   屏幕与顺序 (TAB_META 的键名/顺序需与这里的 <Tabs.Screen name> 对齐).
 *
 * 用自定义 `tabBar` 而非默认 bar: 悬浮胶囊要自控位置/形状/伸缩动画, 默认 bar 给不了.
 *   代价是 screenOptions 里的 tabBarStyle / tabBarBackground / tint 全部失效 (由本组件接管).
 *
 * 关于 paddingBottom: 岛是 `position:absolute` 悬浮的, 内容滚到它底下, 所以各 tab 屏幕
 *   仍需手动给 ScrollView 留 `insets.bottom + 64` 的底部内边距 (见 inbox.tsx / archive.tsx;
 *   岛顶恰在 insets.bottom + 60, 落在这段留白内).
 *
 * @see DynamicIslandTabBar
 * @see https://reactnavigation.org/docs/bottom-tab-navigator
 */
export const unstable_settings = {
  initialRouteName: "inbox",
};

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <DynamicIslandTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="inbox" />
      <Tabs.Screen name="signals" />
      <Tabs.Screen name="archive" />
      <Tabs.Screen name="attention" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
