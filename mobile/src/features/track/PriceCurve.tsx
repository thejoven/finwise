/**
 * PriceCurve —— 可复用收盘折线 (自测宽度). 锚点处竖线 + 标签 (发现日 / 签字日),
 * 基线一条水平虚线 (通常 = 锚点收盘, 让"在锚点之上/之下"一眼可见).
 *
 * 纯 SVG, 自适应容器宽度 (onLayout); 颜色由调用方按累计涨跌方向传入 (红涨绿跌).
 * 调用方负责先判 untrackable / 无数据 —— 本组件只在 ≥2 个收盘点时画线, 绝不画假线.
 * SVG <Text> 用已加载的 JetBrainsMono (与 charts.ts 的 propsForLabels 同源).
 */

import { useState } from "react";
import { type LayoutChangeEvent, StyleSheet, View } from "react-native";
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from "react-native-svg";

import { useThemeColors } from "@/core/theme";
import type { TrackBar } from "@/core/api/track";

export interface CurveAnchor {
  /** ISO 时间 (取日期前缀匹配最近 bar). */
  date: string;
  label: string;
  /** 强调锚点 (如签字日): 实色 + 较密虚线. */
  emphasis?: boolean;
}

interface PriceCurveProps {
  bars: TrackBar[];
  /** hex 颜色 (走 useThemeColors / changeColor). */
  color: string;
  anchors?: CurveAnchor[];
  baseline?: number | null;
  height?: number;
}

/** 找日期 >= 锚点的第一根 bar; 都早于锚点 → 末根. */
function indexForDate(bars: TrackBar[], iso: string): number {
  const target = iso.slice(0, 10);
  for (let i = 0; i < bars.length; i++) {
    if (bars[i]!.date >= target) return i;
  }
  return bars.length - 1;
}

export function PriceCurve({
  bars,
  color,
  anchors = [],
  baseline = null,
  height = 160,
}: PriceCurveProps) {
  const c = useThemeColors();
  const [width, setWidth] = useState(0);

  const onLayout = (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    if (w > 0 && Math.abs(w - width) > 0.5) setWidth(w);
  };

  const closes = bars.map((b) => b.close);
  const ready = width > 0 && closes.length >= 2;

  let content = null;
  if (ready) {
    let min = Math.min(...closes);
    let max = Math.max(...closes);
    if (baseline != null) {
      min = Math.min(min, baseline);
      max = Math.max(max, baseline);
    }
    const span = max - min || 1;
    const topBand = anchors.length > 0 ? 14 : 4;
    const bottomPad = 6;
    const plotTop = topBand;
    const plotBottom = height - bottomPad;
    const plotH = plotBottom - plotTop;
    const stepX = width / (closes.length - 1);
    const yOf = (v: number) => plotTop + (1 - (v - min) / span) * plotH;

    const points = closes.map((v, i) => `${(i * stepX).toFixed(2)},${yOf(v).toFixed(2)}`).join(" ");
    const lastX = (closes.length - 1) * stepX;
    const lastY = yOf(closes[closes.length - 1]!);

    content = (
      <Svg width={width} height={height}>
        {baseline != null ? (
          <Line
            x1={0}
            y1={yOf(baseline)}
            x2={width}
            y2={yOf(baseline)}
            stroke={c.muted2}
            strokeWidth={1}
            strokeDasharray="2 4"
          />
        ) : null}
        {anchors.map((a, i) => {
          const x = indexForDate(bars, a.date) * stepX;
          const textAnchor = x < 28 ? "start" : x > width - 28 ? "end" : "middle";
          return (
            <G key={`${a.label}-${i}`}>
              <Line
                x1={x}
                y1={plotTop}
                x2={x}
                y2={plotBottom}
                stroke={a.emphasis ? c.ink2 : c.muted2}
                strokeWidth={1}
                strokeDasharray={a.emphasis ? "3 3" : "2 4"}
              />
              <SvgText
                x={x}
                y={9}
                fill={c.muted}
                fontSize={9}
                fontFamily="JetBrainsMono-Regular"
                textAnchor={textAnchor}
              >
                {a.label}
              </SvgText>
            </G>
          );
        })}
        <Polyline
          points={points}
          fill="none"
          stroke={color}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <Circle cx={lastX} cy={lastY} r={2.5} fill={color} />
      </Svg>
    );
  }

  return (
    <View style={[styles.container, { height }]} onLayout={onLayout}>
      {content}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: "100%",
    justifyContent: "center",
  },
});
