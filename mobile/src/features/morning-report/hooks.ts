import { useMutation, useQuery } from "@tanstack/react-query";

import { getMorningReport, markReportRead } from "@/core/api/morning-report";

/** 当天 (或指定日期) 的早报. 早报一天一份, 缓存久一点即可. */
export function useMorningReport(date?: string) {
  return useQuery({
    queryKey: ["morning-report", date ?? "latest"],
    queryFn: () => getMorningReport(date),
    staleTime: 5 * 60 * 1000,
  });
}

/** 标记已读 — 不 invalidate (避免打开即标记触发的重取回环); read 状态仅供 Phase 2 角标. */
export function useMarkReportRead() {
  return useMutation({
    mutationFn: (date: string) => markReportRead(date),
  });
}
