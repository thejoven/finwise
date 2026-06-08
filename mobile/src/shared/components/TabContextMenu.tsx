import { type TabContextMenuProps } from "./TabContextMenu.types";

export type { TabMenuActions, TabContextMenuProps } from "./TabContextMenu.types";

/**
 * 非 iOS 平台 (Android / web) 的兜底实现: 原样渲染 tab, 不挂原生 ContextMenu.
 *
 * 长按弹"液态玻璃选择框"是 iOS (UIContextMenu, iOS 26 自动玻璃) 的能力, 且 @expo/ui 的
 *   SwiftUI 视图只在 iOS 注册; 真正实现走平台后缀文件 `TabContextMenu.ios.tsx`, Metro 在
 *   iOS 构建时优先选它. 把 @expo/ui 的 import 关在 .ios 文件里, 避免在 Android 解析时
 *   `requireNativeView('ExpoUI', …)` 找不到原生视图而报错.
 */
// 平台分包: 真正实现走 TabContextMenu.ios.tsx, 本文件是非 iOS 兜底. 二者都被
// DynamicIslandTabBar 经 `./TabContextMenu` 引用 (Metro 平台解析), 故此导出实际有用 ——
// react-doctor 只看到 .ios 那侧被引, 误报本兜底导出未使用.
// react-doctor-disable-next-line react-doctor/unused-export
export function TabContextMenu({ children }: TabContextMenuProps) {
  return <>{children}</>;
}
