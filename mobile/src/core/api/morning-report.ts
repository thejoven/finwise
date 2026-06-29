/**
 * Typed wrapper around /v1/morning-report (早报).
 * zod 在边界校验. 平台每日去标识化编者早报 + 按用户关注的个性化重排/"为你导读".
 */

import { z } from "zod";
import { api } from "./client";

export const ReportSection = z.object({
  id: z.string(),
  heading: z.string(),
  body: z.string(),
  assets: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});
export type ReportSection = z.infer<typeof ReportSection>;

export const ReportAsset = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  mentions: z.number(),
  signal_count: z.number(),
});
export type ReportAsset = z.infer<typeof ReportAsset>;

export const RelevantAsset = z.object({
  ticker: z.string(),
  reason: z.string(),
});
export type RelevantAsset = z.infer<typeof RelevantAsset>;

export const MorningReport = z.object({
  available: z.boolean(),
  edition_date: z.string(),
  language: z.string(),
  is_quiet: z.boolean(),
  signal_count: z.number(),
  headline: z.string().nullable(),
  dek: z.string().nullable(),
  sections: z.array(ReportSection),
  section_order: z.array(z.string()),
  personal_intro: z.string().nullable(),
  relevant_assets: z.array(RelevantAsset),
  top_assets: z.array(ReportAsset),
  read_at: z.string().nullable(),
});
export type MorningReport = z.infer<typeof MorningReport>;

/** 当天 (或指定 date=YYYY-MM-DD) 的个性化早报. 首次打开后端懒构建; 无任何底稿 → available:false. */
export async function getMorningReport(date?: string): Promise<MorningReport> {
  const json = await api
    .get("v1/morning-report", date ? { searchParams: { date } } : undefined)
    .json();
  return MorningReport.parse(json);
}

/** 标记已读 (Phase 2 未读角标用). */
export async function markReportRead(date: string): Promise<void> {
  await api.post("v1/morning-report/read", { json: { date } });
}
