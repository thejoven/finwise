/**
 * 日期 / 时间格式化 —— 全 App 共享, 没装 date-fns, 纯 JS.
 *
 * 历史上散落在 capture/attention/commitment/notifications/refinement 各处, 每个屏自己
 * 用 `new Date()` + padStart 拼一遍, 输出还略有漂移. 现统一收口到这里, 按"输出形态"给
 * 具名导出 —— 需要哪种格式就 import 哪个, 不再就地重写.
 *
 * 约定: 接受 `iso` 的函数假定输入是 ISO-8601 字符串; 接受 `ms` 的函数假定输入是
 *   毫秒(时间戳或时长, 见各自注释).
 */

import i18n from "@/core/i18n";

const MONTH_DAY = "MM·dd";

/** "MM·dd" —— 列表行的紧凑日期戳. */
export function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MONTH_DAY;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}·${dd}`;
}

/** "yyyy.MM.dd · HH:mm" —— 详情页的完整本地时间. */
export function formatLongDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${yyyy}.${mm}.${dd} · ${hh}:${mi}`;
}

/** "MM/dd HH:mm" —— 中等密度的本地时间(洞察卡 / 头部副标题). */
export function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mi = String(d.getMinutes()).padStart(2, "0");
  return `${mm}/${dd} ${hh}:${mi}`;
}

/** "yyyy-MM-dd" —— 仅日期(UTC 切片, 与历史 toISOString 行为一致). */
export function formatIsoDate(iso: string): string {
  if (!iso) return "";
  try {
    return new Date(iso).toISOString().slice(0, 10);
  } catch {
    return iso.slice(0, 10);
  }
}

/** "HH:mm" —— 把毫秒时间戳渲染成当天时钟(通知列表). */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}`;
}

/** "3s" / "1m30s" —— 把毫秒时长渲染成"用了多久"(答题耗时). */
export function formatDuration(ms: number): string {
  if (!ms || ms < 0) return "—";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}m${String(s).padStart(2, "0")}s`;
}

export function isSameLocalDay(iso: string, today = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

/** 本地化星期(短) — 报刊头日期戳, 跟随当前 i18n 语言 (周一 / 週一 / Mon). */
export function weekdayLabel(d: Date = new Date()): string {
  return new Intl.DateTimeFormat(i18n.language, { weekday: "short" }).format(d);
}

/** 本地化"月日" — 报刊头中间的日期戳 (5月15日 / May 15). */
export function monthDayLabel(d: Date = new Date()): string {
  return new Intl.DateTimeFormat(i18n.language, { month: "long", day: "numeric" }).format(d);
}

/** 中文相对时间 — 列表 meta 行用; 超过一周退回日期. */
export function relativeTimeZh(iso: string): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "";
  const diff = Date.now() - t;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return i18n.t("errors.time.justNow");
  if (min < 60) return i18n.t("errors.time.minutesAgo", { count: min });
  const hr = Math.floor(min / 60);
  if (hr < 24) return i18n.t("errors.time.hoursAgo", { count: hr });
  const day = Math.floor(hr / 24);
  if (day === 1) return i18n.t("errors.time.yesterday");
  if (day < 7) return i18n.t("errors.time.daysAgo", { count: day });
  return monthDayLabel(new Date(iso));
}
