/**
 * 隐藏标的 store — zustand + AsyncStorage 持久化 (与 favorites 同范本).
 *
 * 用户在标的追踪页可把某个标的"隐藏": 隐藏后它不再出现在「所有标的 / 收藏标的」, 只留在
 *   「已隐藏」页 (可一键恢复). 纯减干扰, 不删数据 —— 标的的命题/价格照旧, 随时取消隐藏.
 *
 * **本地持久化**: 后端 track 模块无隐藏 API (单用户场景够用); 将来若加 /v1/assets/hidden
 *   可平滑迁成服务端同步. 状态存 Set<assetId> (O(1) 查), 落盘存数组.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "alphax.hiddenAssets.v1";

interface HiddenAssetsState {
  hydrated: boolean;
  /** 隐藏的 asset id 集合. */
  ids: Set<string>;
  hydrate: () => Promise<void>;
  /** 切换某标的的隐藏态 (即时持久化). */
  toggle: (assetId: string) => Promise<void>;
}

export const useHiddenAssets = create<HiddenAssetsState>((set, get) => ({
  hydrated: false,
  ids: new Set<string>(),

  async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          const ids = new Set(parsed.filter((x): x is string => typeof x === "string"));
          set({ ids, hydrated: true });
          return;
        }
      }
    } catch (err) {
      console.warn("[hiddenAssets] hydrate failed:", err);
    }
    set({ hydrated: true });
  },

  async toggle(assetId) {
    // 新建 Set 而非原地改 —— 让订阅 ids 的选择器拿到新引用、正确重渲染.
    const next = new Set(get().ids);
    if (next.has(assetId)) next.delete(assetId);
    else next.add(assetId);
    set({ ids: next });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
    } catch (err) {
      console.warn("[hiddenAssets] persist failed:", err);
    }
  },
}));

/** 响应式判定: 某标的是否已隐藏 (随切换重渲染). */
export function useIsHidden(assetId: string): boolean {
  return useHiddenAssets((s) => s.ids.has(assetId));
}
