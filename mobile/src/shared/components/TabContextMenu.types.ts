import { type ReactNode } from "react";
import { type SFSymbol } from "expo-symbols";

/**
 * 底栏 tab 长按菜单的动作回调集 —— 由 `DynamicIslandTabBar` 提供 (它握有 navigation /
 *   router / auth 等上下文), 平台实现 (`TabContextMenu.ios`) 只负责把这些回调
 *   摆进原生菜单项. 这样 @expo/ui (仅 iOS) 全部收在 .ios 文件里, 共享层不碰它.
 */
export interface TabMenuActions {
  /** 跳到「财知」某子页 (0 信箱 / 1 降噪 / 2 归档 / 3 统计). */
  jumpCaizhi: (page: number) => void;
  /** 「我」→ 编辑资料. */
  editProfile: () => void;
  /** 「我」→ 修改密码. */
  changePassword: () => void;
  /** 「我」→ 通知中心. */
  openNotifications: () => void;
  /** 「我」→ 退出登录 (带确认). */
  logout: () => void;
}

export interface TabContextMenuProps {
  /** 当前 tab 的 route name (caizhi / profile 有菜单; subscriptions 无). */
  routeName: string;
  actions: TabMenuActions;
  /** 该 tab 的 SF Symbol —— 用于长按"高亮预览"(玻璃卡片上居中的图标). */
  icon: SFSymbol;
  /** 常驻可见的 tab 本体 (长按它弹菜单). */
  children: ReactNode;
}
