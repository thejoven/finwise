/**
 * 极简日期格式化 — 没装 date-fns, 用纯 JS.
 * 假定输入是 ISO-8601 字符串.
 */

const MONTH_DAY = "MM·dd";

export function formatMonthDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return MONTH_DAY;
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${mm}·${dd}`;
}

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

export function isSameLocalDay(iso: string, today = new Date()): boolean {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  return (
    d.getFullYear() === today.getFullYear() &&
    d.getMonth() === today.getMonth() &&
    d.getDate() === today.getDate()
  );
}

const CHINESE_WEEKDAY = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];

export function chineseWeekday(d: Date = new Date()): string {
  return CHINESE_WEEKDAY[d.getDay()]!;
}

/** "5月15日" — 报刊头中间的日期戳. */
export function chineseMonthDay(d: Date = new Date()): string {
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** ISO 8601 week-of-year (1-53), 本地时区. */
export function isoWeekOfYear(d: Date = new Date()): number {
  const target = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const diff = target.getTime() - firstThursday.getTime();
  return 1 + Math.round(diff / (7 * 24 * 60 * 60 * 1000));
}
