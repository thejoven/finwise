/**
 * React Query hooks for capture + inbox.
 *
 * - useCaptureSignal: 提交一条信号. 立即写本地 SQLite (status=syncing), 再 POST.
 *   成功后从 SQLite 删除; 失败标 failed/exhausted (attempts 自增, 上限 3).
 * - useSignals: 拉服务端列表. 自适应轮询: 只在有 server-side pending 推演时每 10s 拉一次,
 *   全 done 后停轮询, 省电.
 * - useMergedSignals: 合并 server + local-pending 做展示.
 * - useRetryPending: UI 重试按钮. exhausted 项 reset 后再试.
 */

import { useCallback } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { captureSignal as postSignal, listSignals, type SignalView } from "@/core/api/signals";
import { uuidV4 } from "@/core/uuid";

import { usePendingSignals, type PendingSignal } from "./store";

const SIGNALS_KEY = ["signals"] as const;
const POLL_MS = 10_000;

export interface MergedSignal {
  id: string;
  raw_text: string;
  captured_at: string;
  inference_status: SignalView["inference_status"];
  inference_summary?: string | null;
  inference_tags?: string[];
  /** 本地状态: pending 队列里才有值. server 来的为 undefined. */
  local_sync?: PendingSignal["status"];
  /** 本地状态: 失败重试次数, 让 UI 区分 "重试中" 和 "放弃了". */
  local_attempts?: number;
}

export function useSignals() {
  return useQuery({
    queryKey: SIGNALS_KEY,
    queryFn: () => listSignals({ limit: 50 }),
    // 自适应: 有 server-side pending 推演时才轮询, 否则停. 节电.
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return POLL_MS;
      const hasPending = data.signals.some((s) => s.inference_status === "pending");
      return hasPending ? POLL_MS : false;
    },
    refetchOnMount: true,
  });
}

export function useMergedSignals() {
  const query = useSignals();
  const pending = usePendingSignals((s) => s.items);

  const serverSignals = query.data?.signals ?? [];
  const serverIds = new Set(serverSignals.map((s) => s.id));

  const local: MergedSignal[] = Object.values(pending)
    .filter((p) => !serverIds.has(p.id))
    .map((p) => ({
      id: p.id,
      raw_text: p.raw_text,
      captured_at: p.captured_at,
      inference_status: "pending" as const,
      local_sync: p.status,
      local_attempts: p.attempts,
    }));

  const remote: MergedSignal[] = serverSignals.map((s) => ({
    id: s.id,
    raw_text: s.raw_text,
    captured_at: s.captured_at,
    inference_status: s.inference_status,
    inference_summary: s.inference_summary,
    inference_tags: s.inference_tags,
  }));

  const merged = [...local, ...remote].sort((a, b) => b.captured_at.localeCompare(a.captured_at));

  return {
    data: merged,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

export function useCaptureSignal() {
  const queryClient = useQueryClient();
  const submit = usePendingSignals((s) => s.submit);
  const markFailed = usePendingSignals((s) => s.markFailed);
  const remove = usePendingSignals((s) => s.remove);

  const mutation = useMutation({
    mutationFn: async (rawText: string) => {
      const id = uuidV4();
      const capturedAt = new Date().toISOString();

      // 1) 先落 SQLite (status=syncing). 即使下面 POST 阶段 App 被杀, 重启后
      //    sync queue 也会从 SQLite 恢复并重试.
      await submit({ id, raw_text: rawText, captured_at: capturedAt });

      try {
        await postSignal({
          client_event_id: id,
          raw_text: rawText,
          occurred_at: capturedAt,
        });
        await remove(id);
        await queryClient.invalidateQueries({ queryKey: SIGNALS_KEY });
        return { id, ok: true as const };
      } catch (err) {
        await markFailed(id, err instanceof Error ? err.message : String(err));
        return { id, ok: false as const, error: err };
      }
    },
  });

  const submitNow = useCallback((rawText: string) => mutation.mutateAsync(rawText.trim()), [mutation]);

  return {
    submit: submitNow,
    isSubmitting: mutation.isPending,
  };
}

/** Retry a failed/exhausted local item. UI 给"重试"按钮用. */
export function useRetryPending() {
  const queryClient = useQueryClient();
  const markSyncing = usePendingSignals((s) => s.markSyncing);
  const markFailed = usePendingSignals((s) => s.markFailed);
  const remove = usePendingSignals((s) => s.remove);
  const resetForManualRetry = usePendingSignals((s) => s.resetForManualRetry);

  return useCallback(
    async (item: PendingSignal) => {
      // exhausted 是 "自动重试达上限放弃" 的状态. 用户手动点重试时, 我们重置
      // attempts 让它再获得 3 次机会. 这避免 "失败一次就永久砸死".
      if (item.status === "exhausted") {
        await resetForManualRetry(item.id);
      } else {
        await markSyncing(item.id);
      }
      try {
        await postSignal({
          client_event_id: item.id,
          raw_text: item.raw_text,
          occurred_at: item.captured_at,
        });
        await remove(item.id);
        await queryClient.invalidateQueries({ queryKey: SIGNALS_KEY });
      } catch (err) {
        await markFailed(item.id, err instanceof Error ? err.message : String(err));
      }
    },
    [queryClient, markSyncing, markFailed, remove, resetForManualRetry],
  );
}
