/**
 * 本地 pending signal 队列 (M4 v2).
 *
 * v1 (zustand only) 是内存版, 进程重启就丢. v2 把 SQLite 当 truth, zustand 当
 * 只读 mirror. mutation 永远走 repo, 然后镜回 zustand. UI 用 zustand 选择器
 * 拿数据, 不直接读 SQLite — 避免每个组件 await.
 *
 * 启动顺序: app/_layout.tsx 在 fonts 加载完, render Stack 之前 await hydrate(),
 * 这样 inbox 首屏渲染时 pending 队列已经从磁盘恢复.
 */

import { create } from "zustand";

import {
  deleteById,
  listAll,
  markFailed as repoMarkFailed,
  resetForManualRetry as repoResetForManualRetry,
  upsertSyncing,
  type PendingSignalRow,
  type PendingStatus,
} from "@/core/storage/pending-signals-repo";

const MAX_ATTEMPTS = 3;

export type { PendingStatus };

export interface PendingSignal {
  id: string;
  raw_text: string;
  captured_at: string;
  status: PendingStatus;
  error?: string;
  attempts: number;
  /** Unix ms — sync queue won't retry before this. 0 = retry now. */
  next_retry_at: number;
}

interface PendingState {
  items: Record<string, PendingSignal>;
  /** 启动时调一次. 之后 mutation 自己同步 zustand, 不需要再 hydrate. */
  hydrate: () => Promise<void>;
  submit: (input: { id: string; raw_text: string; captured_at: string }) => Promise<void>;
  markFailed: (id: string, error: string) => Promise<void>;
  markSyncing: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  resetForManualRetry: (id: string) => Promise<void>;
  list: () => PendingSignal[];
}

function rowToSignal(r: PendingSignalRow): PendingSignal {
  return {
    id: r.id,
    raw_text: r.raw_text,
    captured_at: r.captured_at,
    status: r.status,
    error: r.error ?? undefined,
    attempts: r.attempts,
    next_retry_at: r.next_retry_at,
  };
}

export const usePendingSignals = create<PendingState>((set, get) => ({
  items: {},

  hydrate: async () => {
    const rows = await listAll();
    const items: Record<string, PendingSignal> = {};
    for (const r of rows) items[r.id] = rowToSignal(r);
    set({ items });
  },

  submit: async (input) => {
    const row = await upsertSyncing(input);
    const sig = rowToSignal(row);
    set((s) => ({ items: { ...s.items, [sig.id]: sig } }));
  },

  markFailed: async (id, error) => {
    const row = await repoMarkFailed(id, error, MAX_ATTEMPTS);
    if (!row) return;
    const sig = rowToSignal(row);
    set((s) => ({ items: { ...s.items, [sig.id]: sig } }));
  },

  markSyncing: async (id) => {
    // 重投递时把状态翻回 syncing, 但 attempts 不重置. attempts 在 markFailed
    // 时累加, 到 MAX_ATTEMPTS 就 exhausted. 这里只翻状态, 让 UI 知道 "正在重试".
    const existing = get().items[id];
    if (!existing) return;
    set((s) => ({
      items: { ...s.items, [id]: { ...existing, status: "syncing", error: undefined } },
    }));
  },

  remove: async (id) => {
    await deleteById(id);
    set((s) => {
      const next = { ...s.items };
      delete next[id];
      return { items: next };
    });
  },

  resetForManualRetry: async (id) => {
    const row = await repoResetForManualRetry(id);
    if (!row) return;
    const sig = rowToSignal(row);
    set((s) => ({ items: { ...s.items, [sig.id]: sig } }));
  },

  list: () => Object.values(get().items).sort((a, b) => b.captured_at.localeCompare(a.captured_at)),
}));

export { MAX_ATTEMPTS };
