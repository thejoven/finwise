/**
 * ActivityHeatmap — GitHub 式年度活动点阵图 (个人资料页).
 *
 * 口径与后端 GET /v1/me/stats 对齐: 每格 = 某「日」(Asia/Shanghai) 的活动数
 *   = 信号录入 + 过会次数. 后端只回有活动的稀疏日 (days[]) + 窗口 [start, end].
 *
 * 布局: 53 列 (周) × 7 行 (周日→周六), 与 GitHub 贡献图同构. 网格左端补到 start 当周
 *   的周日, 故首列可能有几格落在 start 之前 —— 这些「窗口外」格渲染为透明占位, 不画方块.
 *   横向可滚动 (一年放不进手机宽度时), 默认滚到最右 (最近)。
 *
 * 配色: 5 档. 0 档(无活动)= paper3 + 极淡描边; 1–4 档由 theme.color.green 叠不同不透明度
 *   —— 既是 GitHub 的绿色语义, 又跟随 App 明暗 (走 useThemeColors 纯 hex). 报刊式: 直角
 *   方块、无圆角、栏目戳记同款红菱形.
 */

import { useMemo, useRef } from "react";
import { ScrollView, StyleSheet, View } from "react-native";

import { Mono } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { hexToRgba } from "@/features/attention/charts";
import type { StatsDayDTO } from "@/core/api/account";

const CELL = 12; // 方块边长
const GAP = 3; // 方块间距
const COL = CELL + GAP; // 一列(周)步距
const ROWS = 7; // 周日…周六

/** 把 "YYYY-MM-DD" 解析成「当地正午」的 Date — 避开时区把日期挪到前/后一天. */
function parseDay(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1, 12, 0, 0, 0);
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

export interface ActivityHeatmapProps {
  start: string; // 窗口起始日 (含), YYYY-MM-DD
  end: string; // 窗口结束日 (今天, 含), YYYY-MM-DD
  days: StatsDayDTO[]; // 稀疏: 只含有活动的日
  /** 月份缩写, 12 个 (一月→十二月), 由调用方按当前语言传入. */
  monthLabels: string[];
}

/** 活动数 → 0..4 档. 阈值偏宁缺毋滥: 1 档起步, 4+ 拉满. */
function level(count: number): 0 | 1 | 2 | 3 | 4 {
  if (count <= 0) return 0;
  if (count === 1) return 1;
  if (count <= 3) return 2;
  if (count <= 6) return 3;
  return 4;
}

export function ActivityHeatmap({ start, end, days, monthLabels }: ActivityHeatmapProps) {
  const c = useThemeColors();
  const scrollRef = useRef<ScrollView>(null);

  // 稀疏日 → map.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const d of days) m.set(d.date, d.count);
    return m;
  }, [days]);

  // 网格起点: start 当周的周日 (getDay 0=周日). 终点: end.
  const { weeks, monthTicks } = useMemo(() => {
    const startDate = parseDay(start);
    const endDate = parseDay(end);
    const gridStart = addDays(startDate, -startDate.getDay()); // 退到周日

    const weeks: { key: string; inWindow: boolean; lvl: 0 | 1 | 2 | 3 | 4 }[][] = [];
    const monthTicks: { col: number; label: string }[] = [];
    let cursor = gridStart;
    let col = 0;
    let lastMonth = -1;
    while (cursor <= endDate) {
      const week: { key: string; inWindow: boolean; lvl: 0 | 1 | 2 | 3 | 4 }[] = [];
      for (let row = 0; row < ROWS; row++) {
        const inWindow = cursor >= startDate && cursor <= endDate;
        const key = toKey(cursor);
        // 月份刻度: 每列第一格 (周日) 落入新月份时打一个 tick.
        if (row === 0 && inWindow) {
          const mo = cursor.getMonth();
          if (mo !== lastMonth) {
            monthTicks.push({ col, label: monthLabels[mo] ?? "" });
            lastMonth = mo;
          }
        }
        week.push({ key, inWindow, lvl: inWindow ? level(counts.get(key) ?? 0) : 0 });
        cursor = addDays(cursor, 1);
      }
      weeks.push(week);
      col++;
    }
    return { weeks, monthTicks };
  }, [start, end, counts, monthLabels]);

  const cellColor = (inWindow: boolean, lvl: 0 | 1 | 2 | 3 | 4): string => {
    if (!inWindow) return "transparent";
    if (lvl === 0) return c.paper3;
    const opacity = [0, 0.3, 0.5, 0.72, 1][lvl]!;
    return hexToRgba(c.green, opacity);
  };

  const gridWidth = weeks.length * COL;

  return (
    <View>
      <ScrollView
        ref={scrollRef}
        horizontal
        showsHorizontalScrollIndicator={false}
        // 默认滚到最右 (最近的几周), 与 GitHub 一致.
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: false })}
      >
        <View>
          {/* 月份刻度行 */}
          <View style={[styles.monthRow, { width: gridWidth }]}>
            {monthTicks.map((t) => (
              <Mono
                key={`${t.col}-${t.label}`}
                size={8}
                style={[styles.monthLabel, { left: t.col * COL }]}
              >
                {t.label}
              </Mono>
            ))}
          </View>

          {/* 网格: 一列一周 */}
          <View style={styles.grid}>
            {weeks.map((week, wi) => (
              <View key={wi} style={styles.weekCol}>
                {week.map((cell) => (
                  <View
                    key={cell.key}
                    style={[
                      styles.cell,
                      {
                        backgroundColor: cellColor(cell.inWindow, cell.lvl),
                        borderColor: cell.inWindow && cell.lvl === 0 ? c.ruleSoft : "transparent",
                      },
                    ]}
                  />
                ))}
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

/** 图例: 「少 ▢▢▢▢▢ 多」5 档色阶. lessLabel/moreLabel 由调用方按语言传. */
export function HeatmapLegend({ lessLabel, moreLabel }: { lessLabel: string; moreLabel: string }) {
  const c = useThemeColors();
  const swatch = (lvl: 0 | 1 | 2 | 3 | 4) => {
    const bg = lvl === 0 ? c.paper3 : hexToRgba(c.green, [0, 0.3, 0.5, 0.72, 1][lvl]!);
    return (
      <View
        key={lvl}
        style={[
          styles.legendCell,
          { backgroundColor: bg, borderColor: lvl === 0 ? c.ruleSoft : "transparent" },
        ]}
      />
    );
  };
  return (
    <View style={styles.legendRow}>
      <Mono size={8} style={styles.legendLabel}>
        {lessLabel}
      </Mono>
      {([0, 1, 2, 3, 4] as const).map(swatch)}
      <Mono size={8} style={styles.legendLabel}>
        {moreLabel}
      </Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  monthRow: {
    height: 12,
    marginBottom: 2,
    position: "relative",
  },
  monthLabel: {
    position: "absolute",
    top: 0,
    color: theme.color.muted2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  grid: {
    flexDirection: "row",
  },
  weekCol: {
    marginRight: GAP,
  },
  cell: {
    width: CELL,
    height: CELL,
    marginBottom: GAP,
    borderWidth: StyleSheet.hairlineWidth,
  },
  legendRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: GAP,
    marginTop: theme.spacing.sm,
  },
  legendLabel: {
    color: theme.color.muted2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  legendCell: {
    width: CELL,
    height: CELL,
    borderWidth: StyleSheet.hairlineWidth,
  },
});
