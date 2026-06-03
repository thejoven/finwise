/**
 * 复盘 React Query hooks.
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import {
  finalizeRetrospect,
  getRetrospect,
  listRetrospects,
  startRetrospect,
  submitRetrospectAnswer,
  type Retrospect,
  type RetrospectDimT,
} from "@/core/api/retrospect";
import { uuidV4 } from "@/core/uuid";
import { byIdQuery } from "@/core/api/query";
import { useActiveProject } from "@/features/project/store";

const RETROSPECT_KEY = (id: string) => ["retrospect", id] as const;
const RETROSPECTS_KEY = ["retrospects"] as const;

export function useRetrospect(id: string | undefined) {
  return useQuery(byIdQuery(["retrospect"], id, getRetrospect));
}

export function useRetrospectList() {
  // 按当前激活分类过滤 (key 带 activeId). 兜底列表 key ["retrospects"] 仍被
  // mutation 的 invalidate 前缀匹配命中, 不受影响.
  const activeId = useActiveProject((s) => s.activeId);
  return useQuery({
    queryKey: [...RETROSPECTS_KEY, activeId],
    queryFn: () => listRetrospects(activeId),
  });
}

export function useStartRetrospect() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: {
      commitment_id: string;
      trigger?: "expired" | "closed" | "manual";
    }) => {
      return startRetrospect(input);
    },
    onSuccess: async (retro) => {
      queryClient.setQueryData(RETROSPECT_KEY(retro.id), retro);
      await queryClient.invalidateQueries({ queryKey: RETROSPECTS_KEY });
    },
  });
  return { start: mutation.mutateAsync, isStarting: mutation.isPending };
}

export function useSubmitRetrospectAnswer(retrospectId: string | undefined) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (input: {
      question_no: number;
      question_dim: RetrospectDimT;
      choice: string;
      open_text?: string;
    }) => {
      if (!retrospectId) throw new Error("no retrospect id");
      return submitRetrospectAnswer({
        retrospect_id: retrospectId,
        client_event_id: uuidV4(),
        ...input,
      });
    },
    onSuccess: async (retro) => {
      queryClient.setQueryData(RETROSPECT_KEY(retro.id), retro);
    },
  });
  return { submit: mutation.mutateAsync, isSubmitting: mutation.isPending };
}

export function useFinalizeRetrospect(retrospectId: string | undefined) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async () => {
      if (!retrospectId) throw new Error("no retrospect id");
      return finalizeRetrospect(retrospectId);
    },
    onSuccess: async (retro) => {
      queryClient.setQueryData(RETROSPECT_KEY(retro.id), retro);
      await queryClient.invalidateQueries({ queryKey: RETROSPECTS_KEY });
    },
  });
  return { finalize: mutation.mutateAsync, isFinalizing: mutation.isPending };
}

export type { Retrospect };
