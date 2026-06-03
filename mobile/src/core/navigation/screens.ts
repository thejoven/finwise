/**
 * Root Stack screen 配置表.
 *
 * 把每个屏的 animation / presentation / gestureEnabled 单独抽出来,
 * 避免 _layout.tsx 长成"配置即代码"的圣诞树.
 *
 * 设计原则:
 *   · 根入口 (tabs): 禁用 swipe-back — 已经在 App 主屏, 不应能 "更往回".
 *   · auth (login):  禁用 swipe — 没登陆不应能 swipe 跳过.
 *   · 注册:           允许 swipe — 从 login → register 是 push, 可返回 login.
 *   · modal (capture / profile.edit / profile.password / search): bottom 弹起, 允许下拉 dismiss.
 *   · 详情类 (signal / refinement / commitment / retrospect / colophon): push 右进, 允许左滑返回.
 */

import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";

import { theme } from "@/core/theme";

type ScreenOptions = NativeStackNavigationOptions;

/**
 * 根 Stack 默认: 不显 header, 屏首尾自己渲染.
 * contentStyle 给 native-stack 容器铺 paper 底 (动态色, 随明暗翻) —— 兜住推屏间隙 /
 * modal 边缘露出的原生白底, 暗色模式下尤其重要.
 */
export const rootStackScreenOptions: ScreenOptions = {
  headerShown: false,
  contentStyle: { backgroundColor: theme.color.paper },
};

/** App 主屏 / Tab 容器 — 禁止任何返回手势. */
export const tabsRootScreen: ScreenOptions = {
  gestureEnabled: false,
  animation: "fade",
};

export const loginScreen: ScreenOptions = {
  animation: "fade",
  gestureEnabled: false,
};

export const registerScreen: ScreenOptions = {
  animation: "slide_from_right",
  gestureEnabled: true,
};

/** 底部弹起的 modal — capture / search / profile edit / profile password 共用. */
export const bottomModalScreen: ScreenOptions = {
  presentation: "modal",
  animation: "slide_from_bottom",
  gestureEnabled: true,
};

/** 详情页 — push 右进, 允许左滑返回. */
export const pushDetailScreen: ScreenOptions = {
  animation: "slide_from_right",
  gestureEnabled: true,
};
