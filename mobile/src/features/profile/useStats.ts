/**
 * useMyStats — 个人资料统计的共享数据 hook (GET /v1/me/stats).
 *
 * 资料页内嵌指标行与统计子页共用同一缓存键, 避免两处各拉一次.
 */

import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";

import { getMyStats, type StatsDTO } from "@/core/api/account";

export function useMyStats() {
  return useQuery<StatsDTO>({
    queryKey: ["me", "stats"],
    queryFn: getMyStats,
    staleTime: 60_000,
  });
}

/** 当前语言的 12 个月份缩写 (一月→十二月), 给点阵图月份刻度用. i18next 数组返回. */
export function useMonthLabels(): string[] {
  const { t } = useTranslation();
  const months = t("profile.stats.months", { returnObjects: true });
  if (Array.isArray(months) && months.length === 12) return months as string[];
  // 兜底: 数字月.
  return Array.from({ length: 12 }, (_, i) => String(i + 1));
}
