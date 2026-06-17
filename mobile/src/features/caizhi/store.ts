import { create } from "zustand";

/**
 * 财知子页跨组件跳转 —— 让底栏长按菜单能从任意 tab 跳到「信箱 / 降噪 / 归档」某一子页.
 *
 * 子页本身是 `CaizhiScreen` 内 PagerView 的**本地 ref 状态** (`pagerRef.setPage`); 底栏
 *   (`DynamicIslandTabBar`) 活在 CaizhiScreen 之外, 够不着那个 ref. 故用一颗极简 store 传
 *   "跳转请求": 底栏写 `requestPage(i)` → CaizhiScreen 订阅 `pendingPage`, 落地后 `setPage(i)`
 *   再 `clear()`. 一次性导航意图, 不持久化 (区别于 useActiveProject 那种需要跨启动恢复的状态).
 *
 * @see CaizhiScreen — 消费端 (订阅 pendingPage → setPage)
 * @see DynamicIslandTabBar — 生产端 (长按「财知」菜单 → requestPage)
 */
interface CaizhiNavState {
  /** 待跳转的子页 index (0 信箱 / 1 降噪 / 2 标的 / 3 归档 / 4 统计); null = 无 pending. */
  pendingPage: number | null;
  /** 底栏请求跳到某子页. */
  requestPage: (index: number) => void;
  /** 跳转落地后清空 (CaizhiScreen 消费完调). */
  clear: () => void;
}

export const useCaizhiNav = create<CaizhiNavState>((set) => ({
  pendingPage: null,
  requestPage: (index) => set({ pendingPage: index }),
  clear: () => set({ pendingPage: null }),
}));
