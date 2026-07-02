/**
 * TrackAssetRow —— 信号/归档详情里每个标的一行: 代码 + 名称 + 收盘 sparkline + 累计涨跌角标.
 * 点击进标的专页. 不可追踪 → 诚实显示"无法追踪此标的", 不画假线.
 *
 * 角标取 pct_since_discovery (发现至今); 调用方传 sinceLabel 决定那行小字文案
 * (信号="发现至今", 归档="放下至今").
 */

import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import { isTrackable, type Track } from "@/core/api/track";

import { Sparkline } from "./Sparkline";
import { ChangeBadge } from "./ChangeBadge";
import { changeColor } from "./format";

const KNOWN_MARKETS = new Set(["a", "hk", "us", "crypto", "other"]);

interface TrackAssetRowProps {
  track: Track;
  /** 角标下的小字 (如"发现至今" / "放下至今"). */
  sinceLabel: string;
}

export function TrackAssetRow({ track, sinceLabel }: TrackAssetRowProps) {
  const { t } = useTranslation();
  const c = useThemeColors();
  const { asset } = track;
  const trackable = isTrackable(track);
  const pct = track.pct_since_discovery ?? null;

  const marketLabel = KNOWN_MARKETS.has(asset.market)
    ? t(`track.market.${asset.market}` as "track.market.a")
    : asset.market;

  return (
    <TapEffect
      style={styles.row}
      pressedStyle={styles.pressed}
      onPress={() => router.push(`/asset/${asset.id}`)}
    >
      <View style={styles.left}>
        <Mono size={13} style={styles.ticker}>
          {asset.canonical}
        </Mono>
        <Sans size={10} style={styles.name} numberOfLines={1}>
          {asset.name}
          {marketLabel ? ` · ${marketLabel}` : ""}
        </Sans>
      </View>

      {trackable ? (
        <>
          <Sparkline
            values={track.bars.map((b) => b.close)}
            color={changeColor(pct, c)}
            width={72}
            height={24}
          />
          <View style={styles.right}>
            <ChangeBadge pct={pct} size={12} />
            <Mono size={9} style={styles.since}>
              {sinceLabel}
            </Mono>
          </View>
        </>
      ) : (
        <Serif size={12} italic style={styles.untrackable}>
          {t("track.state.untrackable")}
        </Serif>
      )}
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  pressed: {
    backgroundColor: theme.color.paper3,
  },
  left: {
    flex: 1,
    gap: 2,
  },
  ticker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  name: {
    color: theme.color.muted,
  },
  right: {
    alignItems: "flex-end",
    gap: 2,
    minWidth: 64,
  },
  since: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  untrackable: {
    color: theme.color.muted,
    flexShrink: 1,
    textAlign: "right",
  },
});
