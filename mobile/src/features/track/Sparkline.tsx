/**
 * Sparkline —— 收盘折线微缩图 (无轴、无标签、无背景), 给降噪行 / 信号详情的标的行用.
 *
 * 纯展示: 调用方按累计涨跌方向 (红涨绿跌) 传入 color (hex 字符串, 走 useThemeColors).
 * 不足两点 → 渲染等宽占位 (保持行高稳定, 不画假线).
 */

import { View } from "react-native";
import Svg, { Polyline } from "react-native-svg";

interface SparklineProps {
  /** 收盘价序列 (按日序). */
  values: number[];
  width?: number;
  height?: number;
  /** hex 颜色字符串 (SVG stroke 只吃字符串, 见 charts.ts 注释). */
  color: string;
  strokeWidth?: number;
}

export function Sparkline({
  values,
  width = 64,
  height = 22,
  color,
  strokeWidth = 1.5,
}: SparklineProps) {
  if (values.length < 2) return <View style={{ width, height }} />;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);
  // 上下各留 strokeWidth 余量, 防止峰/谷描边被裁切.
  const pad = strokeWidth;
  const usableH = height - pad * 2;

  const points = values
    .map((v, i) => {
      const x = i * stepX;
      const y = pad + (1 - (v - min) / span) * usableH;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </Svg>
  );
}
