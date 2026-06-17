import { type ReactNode } from "react";
import { StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";

import { UI, MODS } from "@/shared/native";
import { type TabContextMenuProps, type TabMenuActions } from "./TabContextMenu.types";

export type { TabMenuActions, TabContextMenuProps } from "./TabContextMenu.types";

/**
 * iOS 底栏 tab 长按菜单 —— 原生 `UIContextMenu` (iOS 26 下系统自动渲染成液态玻璃, 即
 *   App Store 那种长按玻璃选择框). 走 @expo/ui 的 SwiftUI `ContextMenu`:
 *     · Trigger = 常驻可见的 tab 本体 (短按照常切 tab, 长按弹菜单 —— 系统手势区分二者);
 *     · Items   = 各 tab 的快捷动作 (Button/Divider, 动作回调由 DynamicIslandTabBar 注入).
 *
 * ⚠️ UI / MODS 来自 @/shared/native —— 那里惰性探测 (`requireOptionalNativeModule('ExpoUI')`)
 *   后才 require @expo/ui (静态 import 在没链 ExpoUI pod 的二进制里会加载期抛, 崩在启动).
 *   ExpoUI 缺失时 UI/MODS 为 null, 本组件优雅降级成"无菜单"(原样渲染 tab); 装好原生后菜单
 *   自动生效, 无需再改 JS.
 *
 * 必须裹在 `<Host>` 里 (SwiftUI 视图宿主). Host 钉死 52×48 与 tab 同尺寸, 保持底栏等宽栅格
 *   (滑动高亮按 TAB_WIDTH 算落点, 见 DynamicIslandTabBar), 不靠 matchContents 量, 布局更确定.
 *
 * @see TabContextMenu.tsx — 非 iOS 兜底 (原样渲染, 无菜单)
 * @see https://docs.expo.dev/guides/expo-ui-swift-ui/
 */

/** 与 DynamicIslandTabBar 的 TAB_WIDTH / TAB_HEIGHT 对齐 (那边是局部常量, 不跨文件引以免环引用). */
const TAB_W = 52;
const TAB_H = 48;

/** route name → 菜单项. 返回 null 表示该 tab 不挂菜单 (兜底原样渲染). */
function itemsFor(routeName: string, a: TabMenuActions, t: TFunction): ReactNode {
  if (!UI || !MODS) return null;
  const { Button, Divider } = UI;
  const { disabled } = MODS;
  switch (routeName) {
    case "caizhi":
      return (
        <>
          <Button
            systemImage="tray"
            label={t("components.tabMenu.inbox")}
            onPress={() => a.jumpCaizhi(0)}
          />
          <Button
            systemImage="wand.and.sparkles"
            label={t("components.tabMenu.distill")}
            onPress={() => a.jumpCaizhi(1)}
          />
          <Button
            systemImage="list.star"
            label={t("components.tabMenu.targets")}
            onPress={() => a.jumpCaizhi(2)}
          />
          <Button
            systemImage="archivebox"
            label={t("components.tabMenu.archive")}
            onPress={() => a.jumpCaizhi(3)}
          />
          <Button
            systemImage="chart.line.uptrend.xyaxis"
            label={t("components.tabMenu.stats")}
            onPress={() => a.jumpCaizhi(4)}
          />
        </>
      );
    case "profile":
      return (
        <>
          <Button
            systemImage="square.and.pencil"
            label={t("profile.account.editProfile")}
            onPress={a.editProfile}
          />
          <Button
            systemImage="key"
            label={t("profile.account.changePassword")}
            onPress={a.changePassword}
          />
          <Button
            systemImage="bell"
            label={t("components.tabMenu.notifications")}
            onPress={a.openNotifications}
          />
          <Divider />
          <Button
            systemImage="rectangle.portrait.and.arrow.right"
            label={t("profile.logout.action")}
            // @expo/ui SwiftUI ButtonRole (native), 非 ARIA role —— aria-role 规则在此为误报
            // react-doctor-disable-next-line react-doctor/aria-role
            role="destructive"
            onPress={a.logout}
          />
        </>
      );
    default:
      return null;
  }
}

export function TabContextMenu({ routeName, actions, icon, children }: TabContextMenuProps) {
  const { t } = useTranslation();
  const items = itemsFor(routeName, actions, t);
  if (!UI || !MODS || !items) return <>{children}</>;
  const { Host, ContextMenu, Image } = UI;
  const { frame, glassEffect } = MODS;
  return (
    <Host style={styles.host}>
      <ContextMenu>
        <ContextMenu.Trigger>{children}</ContextMenu.Trigger>
        {/* 长按"高亮": 自定义 Preview —— 图标居中, 衬一张液态玻璃圆角卡片. 不给自定义 Preview
            时, 系统拿透明的 tab 截图当高亮 → 只有裸图标浮起、没有玻璃底. 这里用 @expo/ui 原生
            glassEffect 修饰符给卡片上玻璃 (全在 ContextMenu 的 SwiftUI 树内, 不混 expo-glass-effect). */}
        <ContextMenu.Preview>
          <Image
            systemName={icon}
            size={26}
            modifiers={[
              frame({ width: 64, height: 56, alignment: "center" }),
              glassEffect({
                glass: { variant: "regular" },
                shape: "roundedRectangle",
                cornerRadius: 18,
              }),
            ]}
          />
        </ContextMenu.Preview>
        <ContextMenu.Items>{items}</ContextMenu.Items>
      </ContextMenu>
    </Host>
  );
}

const styles = StyleSheet.create({
  host: { width: TAB_W, height: TAB_H },
});
