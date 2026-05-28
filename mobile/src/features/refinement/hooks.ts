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
import { uuidV4 } from "@/core/uuid";

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
    queryKey: id ? REFINEMENT_KEY(id) : ["refinement", "none"],
    queryFn: () => getRefinement(id!),
    enabled: !!id,
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
    queryKey: signalId
      ? (["refinement-by-signal", signalId] as const)
      : ["refinement-by-signal", "none"],
    queryFn: () => getRefinementBySignal(signalId!),
    enabled: !!signalId,
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
  return useQuery<ResearchListResponse>({
    queryKey: sessionId ? (["research", "session", sessionId] as const) : ["research", "session", "none"],
    queryFn: () => listResearchBySession(sessionId!),
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
  return useQuery<ResearchListResponse>({
    queryKey: signalId ? (["research", "signal", signalId] as const) : ["research", "signal", "none"],
    queryFn: () => listResearchBySignal(signalId!),
    enabled: !!signalId,
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

export type { SessionResponse };
