/**
 * Notifications store — zustand + AsyncStorage 持久化.
 *
 * 用例: AI 推演完成 / refinement 完成 / attention 分析就绪 等异步事件触发时,
 * 同时 1) 弹 toast 即时反馈 2) push 一条到本 store, 用户错过 toast 仍可在
 * "我的 → 消息通知" 中查到历史.
 *
 * 存储:
 *   - 单 AsyncStorage key = "alphax.notifications.v1"
 *   - 上限 100 条, 超出按 FIFO 丢弃 (最旧)
 *   - 每次 mutation 落盘 (项目通知量小, 不需要 debounce)
 *
 * 不用 SQLite — 通知是非关键数据, AsyncStorage JSON dump 足够.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import { create } from "zustand";

const STORAGE_KEY = "alphax.notifications.v1";
const MAX_ITEMS = 100;

export type NotificationType =
  | "inference_done"
  | "attention_done"
  | "refinement_completed"
  | "gate_passed"
  | "commitment_created";

export interface Notification {
  id: string;
  type: NotificationType;
  /** Mono 顶部小字, 例 "AI 推演完成" */
  stamp: string;
  /** Display 标题, 例 "HBM 第三轮涨价..." */
  title: string;
  /** Serif italic 副标 (可选) */
  subtitle?: string;
  /** 点击跳转的 expo-router 路径, 例 "/signal/abc123" (可选) */
  href?: string;
  /** Unix ms */
  createdAt: number;
  read: boolean;
}

interface NotificationsState {
  hydrated: boolean;
  items: Notification[];
  hydrate: () => Promise<void>;
  push: (n: Omit<Notification, "id" | "createdAt" | "read">) => Promise<void>;
  markRead: (id: string) => Promise<void>;
  markAllRead: () => Promise<void>;
  clear: () => Promise<void>;
  unreadCount: () => number;
}

async function persist(items: Notification[]): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.warn("[notifications] persist failed:", err);
  }
}

function genId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useNotifications = create<NotificationsState>((set, get) => ({
  hydrated: false,
  items: [],

  async hydrate() {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const items = JSON.parse(raw) as Notification[];
        // 防御: 万一旧版数据缺字段
        const safe = items.filter(
          (n) => n && typeof n.id === "string" && typeof n.createdAt === "number",
        );
        set({ items: safe, hydrated: true });
        return;
      }
    } catch (err) {
      console.warn("[notifications] hydrate failed:", err);
    }
    set({ hydrated: true });
  },

  async push(n) {
    const item: Notification = {
      ...n,
      id: genId(),
      createdAt: Date.now(),
      read: false,
    };
    const next = [item, ...get().items].slice(0, MAX_ITEMS);
    set({ items: next });
    await persist(next);
  },

  async markRead(id: string) {
    const next = get().items.map((n) => (n.id === id ? { ...n, read: true } : n));
    set({ items: next });
    await persist(next);
  },

  async markAllRead() {
    const next = get().items.map((n) => ({ ...n, read: true }));
    set({ items: next });
    await persist(next);
  },

  async clear() {
    set({ items: [] });
    await AsyncStorage.removeItem(STORAGE_KEY);
  },

  unreadCount() {
    return get().items.filter((n) => !n.read).length;
  },
}));
