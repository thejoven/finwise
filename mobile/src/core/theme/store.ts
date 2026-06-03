/**
 * Appearance store — 外观偏好 (光亮 / 暗黑 / 跟随系统), zustand + AsyncStorage 持久化.
 *
 * 三态:
 *   - "light"  → 强制浅色
 *   - "dark"   → 强制深色
 *   - "system" → 跟随系统 (默认)
 *
 * 真正的明暗切换不在这里改 theme 对象, 而是调 `Appearance.setColorScheme()`:
 *   - 它会同步更新 RN 的 colorScheme 缓存并广播 change 事件
 *   - iOS 据此翻转 trait collection → 全 App 的 DynamicColorIOS 动态色 (见 ./colors)
 *     逐帧重解析, useColorScheme 的消费方 (图表 / 状态栏 / 玻璃 tab) 也跟着重渲染
 *   - 故切换偏好**即时生效, 无需重载**
 *
 * 注意: 这要求 app.json `userInterfaceStyle: "automatic"` —— 否则 iOS 锁死浅色,
 *   setColorScheme('dark') 无效.
 *
 * 与 `@/features/project/store` 同构 (hydrate 在 app/_layout 启动时调一次).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { Appearance } from "react-native";
import { create } from "zustand";

export type AppearancePref = "light" | "dark" | "system";

const STORAGE_KEY = "wiseflow.appearance.v1";

/** 把偏好落到原生外观: system → null (跟随系统), 否则强制. */
function apply(pref: AppearancePref): void {
  Appearance.setColorScheme(pref === "system" ? null : pref);
}

interface AppearanceState {
  hydrated: boolean;
  pref: AppearancePref;
  hydrate: () => Promise<void>;
  setAppearance: (pref: AppearancePref) => Promise<void>;
}

export const useAppearance = create<AppearanceState>((set, get) => ({
  hydrated: false,
  pref: "system",

  async hydrate() {
    if (get().hydrated) return;
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { pref?: unknown };
        const pref =
          parsed.pref === "light" || parsed.pref === "dark" || parsed.pref === "system"
            ? parsed.pref
            : "system";
        apply(pref); // 首帧前就把外观定好, 避免 light→dark 闪
        set({ pref, hydrated: true });
        return;
      }
    } catch (err) {
      console.warn("[appearance] hydrate failed:", err);
    }
    apply("system");
    set({ hydrated: true });
  },

  async setAppearance(pref) {
    apply(pref); // 乐观更新: 先翻外观, 再落盘
    set({ pref });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ pref }));
    } catch (err) {
      console.warn("[appearance] persist failed:", err);
    }
  },
}));
