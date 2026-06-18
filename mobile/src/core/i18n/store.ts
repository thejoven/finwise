/**
 * 语言偏好 store —— zustand + AsyncStorage 持久化, 与 `@/core/theme/store` 同构.
 *
 * 三+态偏好: "system"(跟随系统, 默认) / "zh-Hans" / "zh-Hant" / "en".
 * `resolved` 是偏好解析后的实际语言(system → 设备语言), UI 与服务端用的都是它.
 *
 * 切换即时生效: setLanguage 先 changeLanguage(订阅方重渲染)再落盘, 最后异步推服务端
 * (让后台 AI 生成 —— 五轮追问 / 降噪 / 投决会 —— 与 UI 用同一门语言).
 *
 * hydrate 在 app/_layout 启动时调一次.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

import i18n from "./index";
import { coercePref, resolveLanguage, type LanguagePref, type SupportedLanguage } from "./languages";
import { pushLanguageToServer } from "./sync";

const STORAGE_KEY = "alphax.language.v1";

interface LanguageState {
  hydrated: boolean;
  pref: LanguagePref;
  /** 实际生效语言(已解析 system). */
  resolved: SupportedLanguage;
  hydrate: () => Promise<void>;
  setLanguage: (pref: LanguagePref) => Promise<void>;
}

export const useLanguage = create<LanguageState>((set, get) => ({
  hydrated: false,
  pref: "system",
  resolved: resolveLanguage("system"),

  async hydrate() {
    if (get().hydrated) return;
    let pref: LanguagePref = "system";
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { pref?: unknown };
        pref = coercePref(parsed.pref);
      }
    } catch (err) {
      console.warn("[language] hydrate failed:", err);
    }
    const resolved = resolveLanguage(pref);
    if (i18n.language !== resolved) await i18n.changeLanguage(resolved);
    set({ pref, resolved, hydrated: true });
    // 启动时也同步一次, 保证服务端记录与本机当前语言一致(设备语言可能在后台变过).
    void pushLanguageToServer(resolved);
  },

  async setLanguage(pref) {
    const resolved = resolveLanguage(pref);
    if (i18n.language !== resolved) await i18n.changeLanguage(resolved); // 乐观: 先切 UI
    set({ pref, resolved });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ pref }));
    } catch (err) {
      console.warn("[language] persist failed:", err);
    }
    void pushLanguageToServer(resolved);
  },
}));
