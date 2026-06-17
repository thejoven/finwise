/**
 * 收藏标的 store — zustand + AsyncStorage 持久化 (照 useActiveProject 范本).
 *
 * **本地持久化**: 后端 track 模块只有 resolve/prices/theses/track 五个端点, 无收藏 API.
 *   故星标存本机 (单用户场景够用); 将来若加 /v1/assets/favorites 可平滑迁成服务端同步.
 *
 * 状态存 Set<assetId> (O(1) 查), 落盘存数组. 切换星标会即时持久化, 下次启动 hydrate 恢复.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "wiseflow.favoriteAssets.v1";

interface FavoriteAssetsState {
  hydrated: boolean;
  /** 收藏的 asset id 集合. */
  ids: Set<string>;
  hydrate: () => Promise<void>;
  /** 切换某标的的收藏态 (即时持久化). */
  toggle: (assetId: string) => Promise<void>;
}

export const useFavoriteAssets = create<FavoriteAssetsState>((set, get) => ({
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
      console.warn("[favoriteAssets] hydrate failed:", err);
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
      console.warn("[favoriteAssets] persist failed:", err);
    }
  },
}));

/** 响应式判定: 某标的是否已收藏 (随切换重渲染). */
export function useIsFavorite(assetId: string): boolean {
  return useFavoriteAssets((s) => s.ids.has(assetId));
}
