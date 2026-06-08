/**
 * Sync queue 后台 worker (M4 v2).
 *
 * 触发时机 — 任意一个发生都跑一遍 sweep:
 *   1) App 冷启动 (mount 一次)
 *   2) App 从后台切回前台 (AppState 'active')
 *   3) 网络从不可达切回可达 (NetInfo.isInternetReachable → true)
 *
 * 跑一遍 sweep 做什么:
 *   - 从 SQLite 读所有 status='failed' 且 next_retry_at <= now 的行
 *   - 对每一行: markSyncing → POST → 成功 remove / 失败 markFailed (attempts++)
 *   - attempts 到 MAX_ATTEMPTS=3 后, repo 自动把 status 标为 'exhausted', UI 显示红字
 *
 * Mutex: 同时只有一个 sweep 在跑. 第二个触发到来时, 看见 isFlushing=true 直接 noop.
 * 这避免 "网络切换闪烁导致并发 POST 同一条 signal" 的脏数据.
 *
 * 不渲染任何 UI. 挂在 app/_layout.tsx 的 root, 全局只一个实例.
 */

import { useCallback, useEffect, useRef } from "react";

import { useAppState } from "@/core/network/appstate";
import { useIsReachable } from "@/core/network/netinfo";
import { captureSignal as postSignal } from "@/core/api/signals";
import { useQueryClient } from "@tanstack/react-query";

import { listEligibleForRetry } from "@/core/storage/pending-signals-repo";
import { usePendingSignals } from "./store";

const SIGNALS_KEY = ["signals"] as const;

export function PendingFlush() {
  const queryClient = useQueryClient();
  const markSyncing = usePendingSignals((s) => s.markSyncing);
  const markFailed = usePendingSignals((s) => s.markFailed);
  const remove = usePendingSignals((s) => s.remove);

  // 同时只允许一个 sweep 跑.
  const flushingRef = useRef(false);

  const sweep = useCallback(async () => {
    if (flushingRef.current) return;
    flushingRef.current = true;
    try {
      const eligible = await listEligibleForRetry(Date.now());
      if (eligible.length === 0) return;

      for (const row of eligible) {
        // 串行重投是有意为之 (见顶部注释): mutex + 逐条 POST 避免"同一 signal 并发 POST"的脏数据.
        // 并行化会破坏该保证, 故 async-await-in-loop 在此为误报.
        // react-doctor-disable-next-line react-doctor/async-await-in-loop
        await markSyncing(row.id);
        try {
          await postSignal({
            client_event_id: row.id,
            raw_text: row.raw_text,
            occurred_at: row.captured_at,
            // 重投递时复用当初保存的 project_id, 而不是当前 active.
            project_id: row.project_id,
          });
          await remove(row.id);
        } catch (err) {
          await markFailed(row.id, err instanceof Error ? err.message : String(err));
        }
      }

      // 任何一个成功后, 让 inbox 拉一下 server 列表.
      await queryClient.invalidateQueries({ queryKey: SIGNALS_KEY });
    } finally {
      flushingRef.current = false;
    }
  }, [markSyncing, markFailed, remove, queryClient]);

  // 触发 1 · 冷启动一次.
  useEffect(() => {
    void sweep();
    // 仅冷启动跑一次 (回前台 / 网络恢复另有 effect 兜); sweep 变化不应重跑. 故意空依赖.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // react-doctor-disable-next-line react-doctor/exhaustive-deps
  }, []);

  // 触发 2 · App 从后台回前台.
  const appState = useAppState();
  const prevAppStateRef = useRef(appState);
  useEffect(() => {
    const prev = prevAppStateRef.current;
    prevAppStateRef.current = appState;
    if (prev !== "active" && appState === "active") {
      void sweep();
    }
  }, [appState, sweep]);

  // 触发 3 · 网络从不可达 → 可达.
  const reachable = useIsReachable();
  const prevReachableRef = useRef<boolean | null>(reachable);
  useEffect(() => {
    const prev = prevReachableRef.current;
    prevReachableRef.current = reachable;
    if (prev !== true && reachable === true) {
      void sweep();
    }
  }, [reachable, sweep]);

  return null;
}
