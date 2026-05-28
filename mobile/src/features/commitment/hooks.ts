/**
 * React Query hooks · 承诺书 + 签字 + 持仓.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  getActiveCommitment,
  getActiveHolding,
  getCommitment,
  getHolding,
  postponeCommitment,
  signCommitment,
  type Commitment,
  type Holding,
} from "@/core/api/commitment";
import { uuidV4 } from "@/core/uuid";

const ACTIVE_KEY = ["commitment", "active"] as const;
const COMMITMENT_KEY = (id: string) => ["commitment", id] as const;
const ACTIVE_HOLDING_KEY = ["holding", "active"] as const;
const HOLDING_KEY = (id: string) => ["holding", id] as const;

/** 拉当前活跃承诺书 (drafted/signed/postponed); 204 → null. */
export function useActiveCommitment() {
  return useQuery({
    queryKey: ACTIVE_KEY,
    queryFn: getActiveCommitment,
    refetchInterval: (query) => {
      const data = query.state.data;
      // 没有活跃 commitment 时, 适度轮询看 Narrator 是否写了草稿
      if (!data) return 5_000;
      // drafted 状态: 等用户操作, 不主动轮询
      return false;
    },
  });
}

export function useCommitment(id: string | undefined) {
  return useQuery({
    queryKey: id ? COMMITMENT_KEY(id) : ["commitment", "none"],
    queryFn: () => getCommitment(id!),
    enabled: !!id,
  });
}

export function useActiveHolding() {
  return useQuery({
    queryKey: ACTIVE_HOLDING_KEY,
    queryFn: getActiveHolding,
  });
}

export function useHolding(id: string | undefined) {
  return useQuery({
    queryKey: id ? HOLDING_KEY(id) : ["holding", "none"],
    queryFn: () => getHolding(id!),
    enabled: !!id,
  });
}

/**
 * useSignCommitment — 签字. 客户端 + 服务端双层防重复:
 *   - signing_client_id 在 mutationFn 调用瞬间一次性生成 (用同一个引用即幂等)
 *   - 服务端 ON CONFLICT (user_id, client_event_id) DO NOTHING
 *
 * 签字成功后, UI 应该立即切换到"持仓中"页 (回调里 router.replace).
 */
export function useSignCommitment() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (commitmentId: string) => {
      // 一次性 client_id, 整个 mutation 生命周期内不变 — 双击调用的是同一个 mutateAsync
      const sig = uuidV4();
      return signCommitment({ id: commitmentId, signing_client_id: sig });
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ACTIVE_KEY }),
        queryClient.invalidateQueries({ queryKey: ACTIVE_HOLDING_KEY }),
      ]);
    },
  });
  return { sign: mutation.mutateAsync, isSigning: mutation.isPending };
}

export function usePostponeCommitment() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: { commitmentId: string; reason?: string }) => {
      return postponeCommitment({
        id: input.commitmentId,
        client_event_id: uuidV4(),
        reason: input.reason,
      });
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ACTIVE_KEY });
    },
  });
  return { postpone: mutation.mutateAsync, isPostponing: mutation.isPending };
}

export type { Commitment, Holding };
