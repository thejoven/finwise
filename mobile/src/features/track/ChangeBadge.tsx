/**
 * ChangeBadge —— 累计涨跌角标. 小三角 (涨▲/跌▼) + Mono 百分比, 红涨绿跌.
 * 一眼看出方向, 不喧宾夺主. 无数据 (null) → 灰 "—", 不编造.
 */

import { StyleSheet, View } from "react-native";
import Svg, { Polygon } from "react-native-svg";

import { Mono } from "@/shared/components";
import { useThemeColors } from "@/core/theme";

import { changeColor, formatPct } from "./format";

interface ChangeBadgeProps {
  pct: number | null | undefined;
  /** Mono 字号. */
  size?: number;
  /** 是否画方向三角 (密集行里可关掉只留文字). */
  arrow?: boolean;
}

export function ChangeBadge({ pct, size = 11, arrow = true }: ChangeBadgeProps) {
  const c = useThemeColors();
  const color = changeColor(pct, c);
  const hasDir = pct != null && pct !== 0 && !Number.isNaN(pct);
  const up = (pct ?? 0) > 0;
  const tri = Math.round(size * 0.62);

  return (
    <View style={styles.row}>
      {arrow && hasDir ? (
        <Svg width={tri} height={tri}>
          {up ? (
            <Polygon points={`0,${tri} ${tri / 2},0 ${tri},${tri}`} fill={color} />
          ) : (
            <Polygon points={`0,0 ${tri},0 ${tri / 2},${tri}`} fill={color} />
          )}
        </Svg>
      ) : null}
      <Mono size={size} style={[styles.pct, { color }]}>
        {formatPct(pct)}
      </Mono>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  pct: {
    letterSpacing: 0.5,
  },
});
