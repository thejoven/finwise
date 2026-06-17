/**
 * CommitmentTrackHero —— 承诺/持仓页顶部的"标的表现"hero (P2, 最高价值入口).
 *
 * 锚定签字日的完整曲线 + 顶部醒目累计涨跌, 标"发现"与"签字"两条竖线.
 * 自适应: 已签 → 大数字=签字至今, 叠加签字锚点 + 基线=签字收盘; 未签 → 发现至今.
 * 发现日与签字日同一天 → 合并为一条"发现·签字"竖线 (避免重叠).
 *
 * 多标的承诺: 第一条可追踪的作 hero 曲线, 其余作 sparkline 行. 全不可追踪 → 诚实留白.
 * 追踪是补充: 加载中显轻提示, 出错静默.
 */

import { StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import { Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import { formatIsoDate } from "@/shared/format";
import { isTrackable, type Track } from "@/core/api/track";

import { useCommitmentTrack } from "./hooks";
import { PriceCurveCard } from "./PriceCurveCard";
import { TrackAssetRow } from "./TrackAssetRow";
import { formatClose } from "./format";
import type { CurveAnchor } from "./PriceCurve";

function sameDay(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && a.slice(0, 10) === b.slice(0, 10);
}

export function CommitmentTrackHero({ commitmentId }: { commitmentId: string | undefined }) {
  const { t } = useTranslation();
  const { data, isLoading } = useCommitmentTrack(commitmentId);

  if (!commitmentId) return null;

  const tracks = data?.tracks ?? [];
  const trackable = tracks.filter(isTrackable);

  if (isLoading && tracks.length === 0) {
    return (
      <Serif size={12} italic style={styles.loading}>
        {t("track.state.loading")}
      </Serif>
    );
  }

  // 全不可追踪 (标的是篮子/未上市等) → 诚实一行, 不画假线.
  if (trackable.length === 0) {
    if (tracks.length === 0) return null;
    return (
      <View style={styles.untrackable}>
        <Serif size={13} italic style={styles.untrackableText}>
          {t("track.state.untrackable")}
        </Serif>
        <Serif size={12} italic style={styles.untrackableHint}>
          {t("track.state.untrackableHint")}
        </Serif>
      </View>
    );
  }

  const hero = trackable.find((tk) => tk.role === "primary") ?? trackable[0]!;
  // 其余标的全列 (含不可追踪): TrackAssetRow 自会对 untrackable 诚实留白, 不静默丢弃 (§7).
  const others = tracks.filter((tk) => tk !== hero);

  const signed = hero.signed_at != null && hero.sign_close != null;

  const anchors: CurveAnchor[] = [];
  if (signed && sameDay(hero.anchor_at, hero.signed_at)) {
    anchors.push({ date: hero.anchor_at, label: t("track.anchor.both"), emphasis: true });
  } else {
    anchors.push({ date: hero.anchor_at, label: t("track.anchor.discovery") });
    if (signed && hero.signed_at) {
      anchors.push({ date: hero.signed_at, label: t("track.anchor.sign"), emphasis: true });
    }
  }

  const baseline = signed ? hero.sign_close! : (hero.anchor_close ?? null);
  const anchorCloseLabel = signed
    ? t("track.close.sign", { value: formatClose(hero.sign_close) })
    : t("track.close.anchor", { value: formatClose(hero.anchor_close) });
  const closesLine = `${anchorCloseLabel} · ${t("track.close.latest", {
    value: formatClose(hero.latest_close),
  })}`;
  const asOf =
    hero.latest_date && hero.source
      ? t("track.asOf", { date: formatIsoDate(hero.latest_date), source: hero.source })
      : null;

  return (
    <View style={styles.block}>
      <PriceCurveCard
        bars={hero.bars}
        anchors={anchors}
        baseline={baseline}
        primaryLabel={signed ? t("track.since.sign") : t("track.since.discovery")}
        primaryPct={signed ? (hero.pct_since_sign ?? null) : (hero.pct_since_discovery ?? null)}
        secondaryLabel={signed ? t("track.since.discovery") : undefined}
        secondaryPct={signed ? (hero.pct_since_discovery ?? null) : undefined}
        closesLine={closesLine}
        asOf={asOf}
        height={170}
        onPress={() => router.push(`/asset/${hero.asset.id}`)}
      />
      {others.length > 0 ? (
        <View style={styles.others}>
          {others.map((tk: Track) => (
            <TrackAssetRow key={tk.asset.id} track={tk} sinceLabel={t("track.since.discovery")} />
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    gap: theme.spacing.sm,
  },
  others: {
    paddingHorizontal: theme.spacing.xs,
  },
  loading: {
    color: theme.color.muted,
    paddingVertical: theme.spacing.sm,
  },
  untrackable: {
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
  },
  untrackableText: {
    color: theme.color.ink2,
  },
  untrackableHint: {
    color: theme.color.muted,
    lineHeight: 18,
  },
});
