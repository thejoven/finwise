/**
 * archive tab hooks.
 *
 * 4 个池并行拉. RT 不要太频, 30s 一次足够 (用户从 inbox 切过来时新数据已经在了).
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getGateByRefinement,
  getGateEvaluation,
  listGateChat,
  listGatePool,
  sendGateChat,
  type ArchivePoolT,
  type GateChatMessage,
  type GateEvaluation,
} from "@/core/api/gate";
import { useActiveProject } from "@/features/project/store";
import { byIdQuery } from "@/core/api/query";

const POOL_KEY = (pool: ArchivePoolT, projectId: string | null) =>
  ["gate-pool", pool, projectId] as const;

export function useGatePool(pool: ArchivePoolT) {
  // 跟 inbox 一致: 当前激活分类进 key, 切分类即重拉; null = 全部.
  const activeId = useActiveProject((s) => s.activeId);
  return useQuery({
    queryKey: POOL_KEY(pool, activeId),
    queryFn: () => listGatePool(pool, 20, activeId),
    staleTime: 30_000,
  });
}

/**
 * 按 refinement_id 拿单条评估. 信号详情页底部用.
 *   - undefined refinementId → 不查询
 *   - 没评估过 → data 为 null (不算 error)
 *   - 评估完成 → 拿到完整 GateEvaluation
 *
 * 评估是 refinement.completed 后异步触发, 客户端到这里可能还没到位, 所以默认
 * 5s 轮询直到拿到结果, 拿到后停 (staleTime 60s).
 */
export function useGateByRefinement(refinementId: string | undefined) {
  return useQuery({
    ...byIdQuery(["gate-by-refinement"], refinementId, getGateByRefinement),
    staleTime: 60_000,
    refetchInterval: (query) => {
      if (query.state.data) return false; // 拿到了, 停轮询
      return 5_000;
    },
  });
}

const POOLS: Array<{ id: ArchivePoolT; label: string; meta: string }> = [
  { id: "observation", label: "观察池", meta: "信号还不够厚, 再看看" },
  { id: "lesson", label: "课堂池", meta: "能力圈外, 记下来" },
  { id: "calendar", label: "日历池", meta: "时机不在窗口, 等" },
  { id: "discard", label: "已弃池", meta: "市场已定价, 不进" },
];

// ───── 分析师对话 (归档卡 → 对话页) ─────

/** 单条评估 (含信号上下文). 对话页头部 + 开场白用. */
export function useGateEvaluation(id: string | undefined) {
  return useQuery({
    ...byIdQuery(["gate-evaluation"], id, getGateEvaluation),
    staleTime: 60_000,
  });
}

const CHAT_KEY = (id: string) => ["gate-chat", id] as const;

/** 该评估下的对话消息 (升序). */
export function useGateChat(evaluationId: string | undefined) {
  return useQuery({
    queryKey: evaluationId ? CHAT_KEY(evaluationId) : ["gate-chat", "none"],
    queryFn: () => listGateChat(evaluationId!),
    enabled: !!evaluationId,
    staleTime: 30_000,
  });
}

/**
 * 发消息给否决分析师. 成功把返回的 [用户消息, 回复] 追加进缓存 (不整列重拉).
 * 失败不落任何消息 (server 同样不落) — 调用方保留输入原样重试.
 */
export function useSendGateChat(evaluationId: string | undefined) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (content: string) => sendGateChat(evaluationId!, content),
    onSuccess: (pair) => {
      if (!evaluationId) return;
      queryClient.setQueryData<GateChatMessage[]>(CHAT_KEY(evaluationId), (old) => [
        ...(old ?? []),
        ...pair,
      ]);
    },
  });
  return {
    send: mutation.mutateAsync,
    isSending: mutation.isPending,
    sendError: mutation.isError,
    resetError: mutation.reset,
  };
}

export type { GateChatMessage, GateEvaluation };
