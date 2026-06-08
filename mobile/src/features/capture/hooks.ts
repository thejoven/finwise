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
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { captureSignal as postSignal, listSignals, type SignalView } from "@/core/api/signals";
import { uuidV4 } from "@/core/uuid";
import { useActiveProject } from "@/features/project/store";

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
  /** 所属分类 id; 未分类为 null/undefined. 列表行 / 详情用. */
  project_id?: string | null;
  /** 本地状态: pending 队列里才有值. server 来的为 undefined. */
  local_sync?: PendingSignal["status"];
  /** 本地状态: 失败重试次数, 让 UI 区分 "重试中" 和 "放弃了". */
  local_attempts?: number;
  /** Analyst 推演出的相关标的 (related_assets). "信号" tab 展示用; 其它来源可空. */
  related_assets?: { ticker: string; rationale: string; order: string }[];
}

function useSignals() {
  // 当前激活分类进 queryKey, 切分类即重新拉; null = 全部.
  const activeId = useActiveProject((s) => s.activeId);
  return useQuery({
    queryKey: [...SIGNALS_KEY, activeId],
    queryFn: () => listSignals({ limit: 50, project_id: activeId }),
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

/**
 * useAllSignals — "信号" tab 用: 拉**全部**信号 (跨所有分类) 的完整时间线, 翻页加载.
 *
 * 跟 useSignals 不同: 不按当前 active 分类过滤 — 这是"看见自己"的完整账本
 * (哲学 6 / 12), 要的就是全部. before 游标取上一页最后一条的 captured_at.
 */
export function useAllSignals() {
  return useInfiniteQuery({
    queryKey: [...SIGNALS_KEY, "all"],
    queryFn: ({ pageParam }) => listSignals({ limit: 30, before: pageParam, has_targets: true }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) =>
      lastPage.has_more && lastPage.signals.length > 0
        ? lastPage.signals[lastPage.signals.length - 1]!.captured_at
        : undefined,
    refetchOnMount: true,
  });
}

export function useMergedSignals() {
  const query = useSignals();
  const pending = usePendingSignals((s) => s.items);
  const activeId = useActiveProject((s) => s.activeId);

  const serverSignals = query.data?.signals ?? [];
  const serverIds = new Set(serverSignals.map((s) => s.id));

  // 一次遍历: 过滤 (排除已在 server 的 + 非当前分类的) 同时映射成展示结构.
  const local: MergedSignal[] = Object.values(pending).flatMap((p) =>
    !serverIds.has(p.id) && (activeId === null || p.project_id === activeId)
      ? [
          {
            id: p.id,
            raw_text: p.raw_text,
            captured_at: p.captured_at,
            inference_status: "pending" as const,
            project_id: p.project_id,
            local_sync: p.status,
            local_attempts: p.attempts,
          },
        ]
      : [],
  );

  const remote: MergedSignal[] = serverSignals.map((s) => ({
    id: s.id,
    raw_text: s.raw_text,
    captured_at: s.captured_at,
    inference_status: s.inference_status,
    inference_summary: s.inference_summary,
    inference_tags: s.inference_tags,
    project_id: s.project_id,
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
    mutationFn: async ({ rawText, projectId }: { rawText: string; projectId: string | null }) => {
      const id = uuidV4();
      const capturedAt = new Date().toISOString();
      // project_id 由调用方 (录入页) 显式选定, 在提交那一刻锁定 — 之后用户切换
      // 分类不影响这条 in-flight 信号的归属. 重试也用同一个 project_id.

      // 1) 先落 SQLite (status=syncing). 即使下面 POST 阶段 App 被杀, 重启后
      //    sync queue 也会从 SQLite 恢复并重试.
      await submit({ id, raw_text: rawText, captured_at: capturedAt, project_id: projectId });

      try {
        // 这几个 await 有真实的成功顺序依赖, 不能并行: postSignal 必须先成功, remove
        // (删本地 pending) / invalidate 才能跑; 失败走 catch 保留记录. async-parallel 误报.
        // react-doctor-disable-next-line react-doctor/async-parallel
        await postSignal({
          client_event_id: id,
          raw_text: rawText,
          occurred_at: capturedAt,
          project_id: projectId,
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

  const submitNow = useCallback(
    (rawText: string, projectId: string | null) =>
      mutation.mutateAsync({ rawText: rawText.trim(), projectId }),
    [mutation],
  );

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
        // 同 useCaptureSignal: 成功顺序依赖, 不能并行 (postSignal 成功后才 remove/invalidate).
        // react-doctor-disable-next-line react-doctor/async-parallel
        await postSignal({
          client_event_id: item.id,
          raw_text: item.raw_text,
          occurred_at: item.captured_at,
          // 用提交时保存的 project_id, 而不是当前 active — 保持归属一致.
          project_id: item.project_id,
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
