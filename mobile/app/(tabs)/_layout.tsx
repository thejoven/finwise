import { Tabs } from "expo-router";

import { DynamicIslandTabBar } from "@/shared/components";

/**
 * 底部 Tab: 订阅 · 财知 · 标的 · 我.
 *
 * 「订阅」(subscriptions) 在财知左侧 — 顶替当年「报纸」占位的位置 (报纸当年就是
 *   "财知左侧的新栏目"), 现在是真功能: 订阅 X 账号 → AI 标签/总结 → 阅读/已读 → 转信号.
 *   启动仍落财知 (initialRouteName 不变).
 *
 * 「标的」(track) 在财知右侧 — 标的追踪 Hub 由原财知子页提升为独立全屏 tab (见 TrackScreen):
 *   内部「标的 / 信号 / 订阅」三段改 PagerView 左右滑动. 提升出来后内层横滑不再与外层冲突
 *   (底部 tab 切换走点按/横扫岛体, 非内容区横滑).
 *
 * 此前整合 (见 GOAL): 旧「收件箱/降噪/档案」三个 tab 合并进「财知」(caizhi) 一个 tab,
 *   变成财知页内左右滑动的子页 (信箱/降噪/归档); 「统计」也从底部 tab 并入财知, 成为
 *   财知的子页 (见 CaizhiScreen) —— 故底部不再有独立的「统计」tab.
 *
 * 视觉走"灵动岛"风格 —— 一颗悬浮的墨色胶囊, 选中项展开露出标签, 切换时灵巧伸缩.
 *   整套图标 / 标签 / 配色 / 动画都在 `DynamicIslandTabBar` 里定义, 本文件只声明
 *   屏幕与顺序 (TAB_META 的键名/顺序需与这里的 <Tabs.Screen name> 对齐).
 *
 * 用自定义 `tabBar` 而非默认 bar: 悬浮胶囊要自控位置/形状/伸缩动画, 默认 bar 给不了.
 *   代价是 screenOptions 里的 tabBarStyle / tabBarBackground / tint 全部失效 (由本组件接管).
 *
 * 关于 paddingBottom: 岛是 `position:absolute` 悬浮的, 内容滚到它底下, 所以各 tab 屏幕
 *   仍需手动给 ScrollView 留 `insets.bottom + TAB_BAR_CLEARANCE` 的底部内边距 (常量出自
 *   @/shared/components/glass, 各屏统一引用; 账见 DynamicIslandTabBar 的"高度账").
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
      <Tabs.Screen name="subscriptions" />
      <Tabs.Screen name="morning" />
      <Tabs.Screen name="caizhi" />
      <Tabs.Screen name="track" />
      <Tabs.Screen name="profile" />
    </Tabs>
  );
}
