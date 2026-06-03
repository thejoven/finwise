import { StyleSheet, View } from "react-native";
import { router } from "expo-router";

import { Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";

import { formatMonthDay } from "@/shared/format";
import type { MergedSignal } from "./hooks";

/**
 * 降噪 tab 的行 · 显示"降噪后推断、分析过的金融信号" —— 不是原始观察, 而是分析结果:
 *   - inference_summary: 一句话判断 (主体)
 *   - related_assets:    各受益标的 (ticker + 一阶/二阶/三阶 + 理由)
 *   - inference_tags:    领域标签 (小字)
 *   - raw_text:          只作为很小的"缘起"脚注 (看见自己, 哲学 6), 不是主体.
 *
 * 与 SignalRow 的区别: SignalRow 把原始观察 (raw_text) 放主位, 给收件箱用;
 * 这里把"降噪后的分析"放主位, 给降噪 tab 用.
 */

const ORDER_LABEL: Record<string, string> = {
  first: "一阶",
  second: "二阶",
  third: "三阶",
};

interface Props {
  signal: MergedSignal;
}

export function DenoisedRow({ signal }: Props) {
  const assets = signal.related_assets ?? [];
  const tags = signal.inference_tags ?? [];
  return (
    <TapEffect onPress={() => router.push(`/signal/${signal.id}`)} style={styles.row}>
      <View style={styles.head}>
        <Mono size={10} style={styles.date}>
          {formatMonthDay(signal.captured_at)}
        </Mono>
        {tags.length > 0 ? (
          <Sans size={9} weight="600" style={styles.tags} numberOfLines={1}>
            {tags.slice(0, 3).join(" · ")}
          </Sans>
        ) : null}
      </View>

      {signal.inference_summary ? (
        <Serif size={16} style={styles.summary}>
          {signal.inference_summary}
        </Serif>
      ) : null}

      {assets.length > 0 ? (
        <View style={styles.assets}>
          {assets.slice(0, 6).map((a, i) => (
            <View key={`${a.ticker}-${i}`} style={styles.asset}>
              <View style={styles.assetHead}>
                <Mono size={12} style={styles.ticker}>
                  {a.ticker}
                </Mono>
                {ORDER_LABEL[a.order] ? (
                  <Sans size={9} weight="700" style={styles.order}>
                    {ORDER_LABEL[a.order]}
                  </Sans>
                ) : null}
              </View>
              {a.rationale ? (
                <Serif size={12} style={styles.rationale}>
                  {a.rationale}
                </Serif>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {signal.raw_text ? (
        <Serif size={11} italic style={styles.origin} numberOfLines={1}>
          缘起：{signal.raw_text}
        </Serif>
      ) : null}
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  row: {
    paddingVertical: theme.spacing.base,
    paddingHorizontal: theme.spacing.lg,
    gap: theme.spacing.sm,
  },
  head: {
    flexDirection: "row",
    alignItems: "baseline",
    justifyContent: "space-between",
    gap: theme.spacing.sm,
  },
  date: {
    color: theme.color.muted,
  },
  tags: {
    color: theme.color.muted,
    letterSpacing: 0.5,
    flexShrink: 1,
    textAlign: "right",
  },
  summary: {
    color: theme.color.ink,
    lineHeight: 23,
  },
  assets: {
    gap: theme.spacing.sm,
    marginTop: theme.spacing.xxs,
    paddingTop: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  asset: {
    gap: 2,
  },
  assetHead: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  ticker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  order: {
    color: theme.color.paper,
    backgroundColor: theme.color.ink2,
    paddingHorizontal: 5,
    paddingVertical: 1,
    letterSpacing: 1,
    overflow: "hidden",
  },
  rationale: {
    color: theme.color.ink2,
    lineHeight: 18,
  },
  origin: {
    color: theme.color.muted2,
    marginTop: theme.spacing.xs,
  },
});
