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
