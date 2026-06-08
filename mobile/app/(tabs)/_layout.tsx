import { Tabs } from "expo-router";

import { DynamicIslandTabBar } from "@/shared/components";

/**
 * 底部 Tab: 报纸 · 财知 · 统计 · 我.
 *
 * 本轮整合 (见 GOAL): 旧「收件箱/降噪/档案」三个 tab 合并进「财知」(caizhi) 一个 tab,
 *   三者变成财知页内左右滑动的子页 (信箱/降噪/归档); 财知左侧新增占位「报纸」(newspaper).
 *
 * 视觉走"灵动岛"风格 —— 一颗悬浮的墨色胶囊, 选中项展开露出标签, 切换时灵巧伸缩.
 *   整套图标 / 标签 / 配色 / 动画都在 `DynamicIslandTabBar` 里定义, 本文件只声明
 *   屏幕与顺序 (TAB_META 的键名/顺序需与这里的 <Tabs.Screen name> 对齐).
 *
 * 用自定义 `tabBar` 而非默认 bar: 悬浮胶囊要自控位置/形状/伸缩动画, 默认 bar 给不了.
 *   代价是 screenOptions 里的 tabBarStyle / tabBarBackground / tint 全部失效 (由本组件接管).
 *
 * 关于 paddingBottom: 岛是 `position:absolute` 悬浮的, 内容滚到它底下, 所以各 tab 屏幕
 *   仍需手动给 ScrollView 留 `insets.bottom + 64` 的底部内边距 (见 InboxView / DenoiseView /
 *   ArchiveView; 岛顶恰在 insets.bottom + 60, 落在这段留白内).
 *
 * @see DynamicIslandTabBar
 * @see https://reactnavigation.org/docs/bottom-tab-navigator
 */
// Expo Router 要求路由配置从路由文件本身导出, 无法外移 —— only-export-components 与框架约定冲突.
// react-doctor-disable-next-line react-doctor/only-export-components
export const unstable_settings = {
  initialRouteName: "caizhi",
};

export default function TabLayout() {
  return (
    <Tabs
      tabBar={(props) => <DynamicIslandTabBar {...props} />}
      screenOptions={{ headerShown: false }}
    >
      <Tabs.Screen name="newspaper" />
      <Tabs.Screen name="caizhi" />
      <Tabs.Screen name="attention" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
