/**
 * 持仓 open / companion hooks.
 */

import { useMutation, useQuery } from "@tanstack/react-query";

import {
  getCompanion,
  recordOpen,
  type CompanionView,
  type OpenResponse,
} from "@/core/api/companion";
import { uuidV4 } from "@/core/uuid";

const COMPANION_KEY = (id: string) => ["companion", id] as const;

/** useCompanion 拉今天的 companion 卡 (若 backend 已发). */
export function useCompanion(commitmentId: string | undefined) {
  return useQuery({
    queryKey: commitmentId ? COMPANION_KEY(commitmentId) : ["companion", "none"],
    queryFn: () => getCompanion(commitmentId!),
    enabled: !!commitmentId,
  });
}

/** useRecordOpen — 进入承诺/持仓页时调一次, server 累加 open 次数 + 必要时回 companion. */
export function useRecordOpen() {
  const mutation = useMutation<
    OpenResponse,
    Error,
    { commitment_id: string; origin?: "tab" | "deeplink" | "trigger_card" }
  >({
    mutationFn: async (input) =>
      recordOpen({
        client_event_id: uuidV4(),
        commitment_id: input.commitment_id,
        origin: input.origin ?? "tab",
        opened_at: new Date().toISOString(),
      }),
  });
  return { open: mutation.mutateAsync, last: mutation.data };
}

export type { CompanionView, OpenResponse };
