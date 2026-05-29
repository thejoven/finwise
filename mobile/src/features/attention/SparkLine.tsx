/**
 * SparkLine — 用 Box-drawing 字符画微型趋势线 (Tufte 风).
 *
 * 输入: 一组 0-100 数字 (例 [60, 72, 80, 65, 90]). 每个映射到 ▁▂▃▄▅▆▇█ 一格.
 * 输出: 一行 Mono 字符. 不引图表库, 视觉极简.
 */

import { StyleSheet } from "react-native";

import { Mono } from "@/shared/components";
import { theme } from "@/core/theme";

interface Props {
  label?: string;
  points: number[]; // 0-100 各点
}

const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];

function blockFor(score: number): string {
  const clamped = Math.max(0, Math.min(100, score));
  const idx = Math.min(BLOCKS.length - 1, Math.floor((clamped / 100) * BLOCKS.length));
  return BLOCKS[idx]!;
}

export function SparkLine({ label, points }: Props) {
  const spark = points.length > 0 ? points.map(blockFor).join("") : "─";
  const last = points[points.length - 1] ?? 0;

  return (
    <Mono size={12} style={styles.row}>
      {label ? <Mono size={9} style={styles.label}>{`${label}  `}</Mono> : null}
      {spark} {last}
    </Mono>
  );
}

const styles = StyleSheet.create({
  row: {
    color: theme.color.ink,
    letterSpacing: 0.5,
    lineHeight: 18,
  },
  label: {
    color: theme.color.muted,
    letterSpacing: 1.5,
  },
});
