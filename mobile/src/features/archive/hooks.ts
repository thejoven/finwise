/**
 * archive tab hooks.
 *
 * 4 个池并行拉. RT 不要太频, 30s 一次足够 (用户从 inbox 切过来时新数据已经在了).
 */

import { useQuery } from "@tanstack/react-query";

import {
  getGateByRefinement,
  listGatePool,
  type ArchivePoolT,
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

export const POOLS: Array<{ id: ArchivePoolT; label: string; meta: string }> = [
  { id: "observation", label: "观察池", meta: "信号还不够厚, 再看看" },
  { id: "lesson", label: "课堂池", meta: "能力圈外, 记下来" },
  { id: "calendar", label: "日历池", meta: "时机不在窗口, 等" },
  { id: "discard", label: "已弃池", meta: "市场已定价, 不进" },
];

export type { GateEvaluation };
