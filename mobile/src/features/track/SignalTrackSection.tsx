/**
 * SignalTrackSection —— 信号详情页的"标的走势"区块 (P3).
 * 每个标的一行 sparkline + 发现至今 %. 点行进标的专页.
 *
 * 仅当至少一个标的可追踪时才渲染 —— 全不可追踪的信号 (如 xAI/OpenAI) 由上方
 * FinancialTargets 已列名, 这里不重复堆"无法追踪". 混合时可追踪行画线、不可追踪行诚实留白.
 * 追踪是补充信息: 加载中/出错静默 (不打断主页面).
 */

import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { DoubleRule, Mono, SectionHeader, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import { formatIsoDate } from "@/shared/format";
import { isTrackable } from "@/core/api/track";

import { useSignalTrack } from "./hooks";
import { TrackAssetRow } from "./TrackAssetRow";

export function SignalTrackSection({ signalId }: { signalId: string | undefined }) {
  const { t } = useTranslation();
  const { data } = useSignalTrack(signalId);
  const tracks = data?.tracks ?? [];

  // 可追踪的排前面; 仅当存在可追踪标的才出区块.
  const sorted = useMemo(
    () => tracks.slice().sort((a, b) => Number(isTrackable(b)) - Number(isTrackable(a))),
    [tracks],
  );
  const firstTrackable = sorted.find(isTrackable);

  if (!signalId || !firstTrackable) return null;

  const asOf =
    firstTrackable.latest_date && firstTrackable.source
      ? t("track.asOf", {
          date: formatIsoDate(firstTrackable.latest_date),
          source: firstTrackable.source,
        })
      : null;

  return (
    <View style={styles.block}>
      <SectionHeader label={t("track.section.label")} meta={t("track.section.meta")} />
      <DoubleRule />
      <Serif size={12} italic style={styles.intro}>
        {t("track.section.signalIntro")}
      </Serif>
      <View style={styles.list}>
        {sorted.map((tk) => (
          <TrackAssetRow key={tk.asset.id} track={tk} sinceLabel={t("track.since.discovery")} />
        ))}
      </View>
      {asOf ? (
        <Mono size={9} style={styles.asOf}>
          {asOf}
        </Mono>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  block: {
    marginTop: theme.spacing.xl,
  },
  intro: {
    color: theme.color.muted,
    marginTop: theme.spacing.sm,
  },
  list: {
    marginTop: theme.spacing.xs,
  },
  asOf: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
    marginTop: theme.spacing.sm,
  },
});
