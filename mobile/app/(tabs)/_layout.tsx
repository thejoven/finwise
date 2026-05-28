import { NativeTabs, Icon, Label } from "expo-router/unstable-native-tabs";

import { theme } from "@/core/theme";

/**
 * 底部 Tab: 收件箱 · 档案.
 *
 * Phase ?: 改用 expo-router 6 的 NativeTabs (基于 react-native-screens 的原生
 *   UITabBarController). 收益:
 *     · iOS 26+ 默认 liquid glass tab bar
 *     · iOS 18 及以下 fallback 到 systemChromeMaterial blur
 *     · 滚动到底时 tab bar 透明融入内容; minimizeBehavior=onScrollDown 滚动收起
 *     · SF Symbol 原生图标, 系统 active/inactive 状态自动切换
 *
 * 中间 "+" 录入按钮: 不再做底部 tab. NativeTabs 是 native UITabBarController,
 *   tabPress 无法拦截弹 modal — 把录入入口移到 Masthead 右上角 (用 + 替换原 Phase 1
 *   留位的 Search icon). 这样底部只剩 2 个真 tab, liquid glass 视觉更干净.
 *
 * @see https://reactnavigation.org/docs/8.x/bottom-tab-navigator
 * @see expo-router/build/native-tabs/NativeBottomTabs/types.d.ts (本地 d.ts)
 */
export const unstable_settings = {
  initialRouteName: "inbox",
};

export default function TabLayout() {
  return (
    <NativeTabs
      // iOS 18 及以下的 blur (iOS 26+ liquid glass 是默认行为, 由系统自动选择).
      blurEffect="systemChromeMaterial"
      // 滚动到底时禁用 "tab bar 融入透明背景" 的系统默认行为, 始终保持 glass.
      // API 名是 `disable`, 所以 true = 禁用透明 = 一直显示毛玻璃.
      disableTransparentOnScrollEdge={true}
      // iOS 26+ 滚动行为: 向下滚收起, 向上滚展开. 老 iOS 自动忽略.
      minimizeBehavior="onScrollDown"
      iconColor={{
        default: theme.color.muted,
        selected: theme.color.ink,
      }}
      tintColor={theme.color.ink}
      labelStyle={{
        default: {
          fontFamily: theme.fontFamily.cjkRegular,
          fontSize: 10,
        },
        selected: {
          fontFamily: theme.fontFamily.cjkBold,
          fontSize: 10,
          color: theme.color.ink,
        },
      }}
    >
      <NativeTabs.Trigger name="inbox">
        <Icon sf={{ default: "tray", selected: "tray.fill" }} />
        <Label>收件箱</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="archive">
        <Icon sf={{ default: "archivebox", selected: "archivebox.fill" }} />
        <Label>档案</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="profile">
        <Icon sf={{ default: "person", selected: "person.fill" }} />
        <Label>我</Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
