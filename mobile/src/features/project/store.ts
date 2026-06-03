/**
 * Active project store — zustand + AsyncStorage 持久化.
 *
 * 三态:
 *   - hydrated = false → 刚启动, 正在从磁盘读
 *   - activeId = null  → "全部" (未筛选)
 *   - activeId = uuid  → 当前选中的分类
 *
 * 切换 active project 会:
 *   1) 持久化到 AsyncStorage (下次启动恢复)
 *   2) 后续 capture 自动绑定 active project_id
 *   3) AttentionScreen 自动按 active project 过滤
 *
 * 列表本身从 server 拉, 不在 store 里缓存 — 用 react-query
 * (queryKey ["projects"]) 兜.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "wiseflow.activeProject.v1";

interface ActiveProjectState {
  hydrated: boolean;
  /** 当前选中的分类 id; null = "全部" */
  activeId: string | null;
  hydrate: () => Promise<void>;
  setActive: (id: string | null) => Promise<void>;
  /** 分类被归档/删除时清空 active. UI 调用. */
  clearIfMatches: (id: string) => Promise<void>;
}

export const useActiveProject = create<ActiveProjectState>((set, get) => ({
  hydrated: false,
  activeId: null,

  async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { activeId: string | null };
        if (parsed && (parsed.activeId === null || typeof parsed.activeId === "string")) {
          set({ activeId: parsed.activeId, hydrated: true });
          return;
        }
      }
    } catch (err) {
      console.warn("[activeProject] hydrate failed:", err);
    }
    set({ hydrated: true });
  },

  async setActive(id) {
    set({ activeId: id });
    try {
      await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({ activeId: id }));
    } catch (err) {
      console.warn("[activeProject] persist failed:", err);
    }
  },

  async clearIfMatches(id) {
    if (get().activeId === id) {
      await get().setActive(null);
    }
  },
}));
