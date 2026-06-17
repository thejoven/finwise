/**
 * CompactTrackStrip —— 信号标的的极简价格条: 每个可追踪标的一行 代码 + micro sparkline + 涨跌角标.
 * 降噪行 / 归档卡里嵌一眼"读对没". **纯展示不可点** —— 父行本身已是 TapEffect (进信号/对话),
 * 避免嵌套 touchable 抢手势.
 *
 * 只渲染可追踪标的; 全不可追踪 / 无数据 → 不出条 (列表行保持干净, 不堆"无法追踪").
 * 列表里逐行拉 track (staleTime 5min 缓存, FlatList 只挂可见行).
 */

import { StyleSheet, View } from "react-native";

import { Mono } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { isTrackable } from "@/core/api/track";

import { useSignalTrack } from "./hooks";
import { Sparkline } from "./Sparkline";
import { ChangeBadge } from "./ChangeBadge";
import { changeColor } from "./format";

interface CompactTrackStripProps {
  signalId: string;
  /** 最多显示几条标的 (默认 3). */
  max?: number;
  /** 可选前导小字 (如归档的"放下至今"). */
  caption?: string;
}

export function CompactTrackStrip({ signalId, max = 3, caption }: CompactTrackStripProps) {
  const c = useThemeColors();
  const { data } = useSignalTrack(signalId);
  const trackable = (data?.tracks ?? []).filter(isTrackable).slice(0, max);

  if (trackable.length === 0) return null;

  return (
    <View style={styles.strip}>
      {caption ? (
        <Mono size={9} style={styles.caption}>
          {caption}
        </Mono>
      ) : null}
      {trackable.map((tk) => {
        const pct = tk.pct_since_discovery ?? null;
        return (
          <View key={tk.asset.id} style={styles.row}>
            <Mono size={11} style={styles.ticker} numberOfLines={1}>
              {tk.asset.canonical}
            </Mono>
            <Sparkline
              values={tk.bars.map((b) => b.close)}
              color={changeColor(pct, c)}
              width={56}
              height={18}
            />
            <ChangeBadge pct={pct} size={10} arrow={false} />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    gap: 4,
    marginTop: theme.spacing.xs,
  },
  caption: {
    color: theme.color.muted2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  ticker: {
    color: theme.color.ink2,
    letterSpacing: 0.5,
    minWidth: 56,
  },
});
