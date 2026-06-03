/**
 * React Query hooks · 五轮追问.
 *
 * - useStartRefinement: 从信号详情触发, 创建 session 并跳转到 /refinement/[id]
 * - useRefinementSession: 自适应轮询. 等待"下一题"时每 2s 拉; 题目就位 + 全答完后停.
 * - useSubmitAnswer: 提交一轮答案. 成功后 invalidate session.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import {
  getRefinement,
  getRefinementBySignal,
  startRefinement,
  submitAnswer,
  type SessionResponse,
  type SubmitAnswerInput,
} from "@/core/api/refinement";
import {
  listResearchBySession,
  listResearchBySignal,
  type ResearchListResponse,
} from "@/core/api/research";
import { getDistillation, proceedToGate } from "@/core/api/distillation";
import { uuidV4 } from "@/core/uuid";
import { byIdQuery } from "@/core/api/query";

const REFINEMENT_KEY = (id: string) => ["refinement", id] as const;
const POLL_WAITING_MS = 2_000;
const POLL_IDLE_MS = 10_000;

export function useStartRefinement() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { primary_signal_id: string; primary_asset?: string | null }) => {
      const res = await startRefinement({
        client_event_id: uuidV4(),
        primary_signal_id: input.primary_signal_id,
        primary_asset: input.primary_asset,
      });
      queryClient.setQueryData(REFINEMENT_KEY(res.id), res);
      return res;
    },
  });
  return {
    start: mutation.mutateAsync,
    isStarting: mutation.isPending,
  };
}

/**
 * 拉取一个 session. 自适应:
 *   - status=completed → 不轮询
 *   - pending_question 存在 → 不轮询 (等用户答)
 *   - 等待出题 (刚提交了答案, 下一题还没回) → 2s 轮一次
 *   - 默认 → 10s 轮一次 (兜底)
 */
export function useRefinementSession(id: string | undefined) {
  return useQuery({
    ...byIdQuery(["refinement"], id, getRefinement),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data) return POLL_WAITING_MS;
      if (data.status !== "active") return false;
      if (data.pending_question) return false; // 题目就位, 等用户答
      // active 但没 pending_question = 等 Mastra 出题
      return POLL_WAITING_MS;
    },
    refetchOnMount: true,
  });
}

/**
 * 信号详情页用. 拉该信号上最近一次已完成的五轮追问.
 *   - 没有完成过 → data 为 null (不是 error). UI 不渲染历史区.
 *   - 完成过 → 返回完整 SessionView, 含 rounds 全量.
 */
export function useRefinementBySignal(signalId: string | undefined) {
  return useQuery({
    ...byIdQuery(["refinement-by-signal"], signalId, getRefinementBySignal),
    staleTime: 60_000, // 1 分钟内不重拉 — 历史不太会变
  });
}

/**
 * 拉一次 session 范围内全部 research (signal-scope + 各 round-scope).
 *
 * 轮询策略:
 *   - session 不存在 → 不 enable
 *   - signal-scope research 还没到位 (常见情况: 用户刚 capture 完, mastra 还在搜) → 3s 轮一次
 *   - 已到位 → 30s 兜底, 让后续 round 的 research 也能进来
 *   - active session 已 5 轮答完 (commitment_setup, round 5) → 不再 poll
 */
export function useSessionResearch(sessionId: string | undefined, opts?: { stop?: boolean }) {
  return useQuery({
    ...byIdQuery(["research", "session"], sessionId, listResearchBySession),
    enabled: !!sessionId && !opts?.stop,
    refetchInterval: (query) => {
      if (opts?.stop) return false;
      const data = query.state.data;
      if (!data || data.items.length === 0) return 3_000;
      return 30_000;
    },
    staleTime: 5_000,
  });
}

/**
 * 信号详情页用 · 按 signal_id 一把拉该信号的全部研究材料.
 *
 * server 端 ListBySignal 会返回:
 *   - signal-scope 那条 (Analyst 阶段背景检索)
 *   - 该 signal 上各次 refinement 各轮的 refinement_round-scope 检索
 *     (因为 round-scope 写入时 signal_id 填的是 session.primary_signal_id)
 *
 * 不需要轮询 — 详情页是历史查看场景, staleTime 60s 兜底.
 */
export function useSignalResearch(signalId: string | undefined) {
  return useQuery({
    ...byIdQuery(["research", "signal"], signalId, listResearchBySignal),
    staleTime: 60_000,
  });
}

export function useSubmitAnswer(sessionId: string | undefined) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: Omit<SubmitAnswerInput, "session_id" | "client_event_id">) => {
      if (!sessionId) throw new Error("no session_id");
      return submitAnswer({
        ...input,
        session_id: sessionId,
        client_event_id: uuidV4(),
      });
    },
    onSuccess: async () => {
      if (sessionId) {
        await queryClient.invalidateQueries({ queryKey: REFINEMENT_KEY(sessionId) });
      }
    },
  });

  const submit = useCallback(
    (input: Omit<SubmitAnswerInput, "session_id" | "client_event_id">) =>
      mutation.mutateAsync(input),
    [mutation],
  );

  return { submit, isSubmitting: mutation.isPending };
}

/**
 * 降噪页轮询 · 追问完成后 mastra post-refinement 异步写回.
 *   - 还没生成 (null) 或降噪综述未到 → 2s 轮
 *   - 降噪综述到了但金融信号还在推演 (beneficiary == null) → 3s 轮
 *   - 都到位 (beneficiary 是 [] 或 [...]) → 停
 * 不显示 spinner — 降噪页用 typewriter 等待 (符合产品哲学).
 */
export function useDistillation(refinementId: string | undefined) {
  return useQuery({
    ...byIdQuery(["distillation"], refinementId, getDistillation),
    refetchInterval: (query) => {
      const data = query.state.data;
      if (!data || data.distilled_content == null) return 2_000;
      if (data.beneficiary == null) return 3_000;
      return false;
    },
    refetchOnMount: true,
  });
}

/** 降噪页"进入四道门" — 手动触发四道门评估 ("前置于四道门"流程). */
export function useProceedToGate() {
  const mutation = useMutation({
    mutationFn: (refinementId: string) => proceedToGate(refinementId),
  });
  return { proceed: mutation.mutateAsync, isProceeding: mutation.isPending };
}

export type { SessionResponse };
