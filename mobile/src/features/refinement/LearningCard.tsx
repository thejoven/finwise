/**
 * LearningCard — 出题前的"加载学习了哪些内容"卡片.
 *
 * 位置: RefinementScreen 底部 (题目下方), 默认**折叠**, 只露一行 header.
 * 不抢用户阅读焦点 — 想看的人主动展开, 不想看的人不被打扰.
 *
 * 折叠态:
 *   ♦ 相关线索 · 5 条来源 · 展开 ↓
 *   ♦ 相关线索 · 加载中 · …
 *   ♦ 相关线索 · 未检索到外部资料
 *
 * 展开态:
 *   ♦ 相关线索 · 5 条来源 · 收起 ↑
 *   ── 背景检索
 *   [来源 1..n]
 *   ── 本轮线索 · R1
 *   [来源 1..n]
 *   ...
 *
 * 每条 = domain (大写小字 + letter-spacing) + Serif 标题 + 灰色描述. 点击 → 系统浏览器打开 url.
 */

import { useState } from "react";
import { Linking, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { type TFunction } from "i18next";

import { Icon, Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type { ResearchRecord, MarketData } from "@/core/api/research";

export interface LearningCardProps {
  items?: ResearchRecord[]; // undefined = 还在拉; [] = 拉到了但空
  loading: boolean;
  /** 初始是否展开. 默认 false (折叠) — 不抢用户题目焦点. */
  defaultExpanded?: boolean;
}

export function LearningCard({ items, loading, defaultExpanded = false }: LearningCardProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(defaultExpanded);

  const totalResults = (items ?? []).reduce((acc, r) => acc + r.results.length, 0);
  const statusMeta = computeStatusMeta({ items, loading, totalResults }, t);

  return (
    <View style={styles.container}>
      <TapEffect
        style={styles.header}
        pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={styles.diamond} />
        <Sans size={10} weight="700" style={styles.label}>
          {t("refinement.clues.label")}
        </Sans>
        <Serif size={10} italic style={styles.meta}>
          {statusMeta}
        </Serif>
        {statusMeta && totalResults > 0 ? (
          expanded ? (
            <Icon name="chevronUp" size={14} color={theme.color.muted} strokeWidth={1.5} />
          ) : (
            <Icon name="chevronDown" size={14} color={theme.color.muted} strokeWidth={1.5} />
          )
        ) : null}
      </TapEffect>

      {expanded ? <ExpandedBody items={items} totalResults={totalResults} /> : null}
    </View>
  );
}

function computeStatusMeta(
  {
    items,
    loading,
    totalResults,
  }: {
    items?: ResearchRecord[];
    loading: boolean;
    totalResults: number;
  },
  t: TFunction,
): string {
  if (totalResults > 0) return t("refinement.learning.metaSources", { count: totalResults });
  if (!items && loading) return t("refinement.learning.metaLoading");
  return t("refinement.learning.metaNone");
}

/**
 * LearningTimeline — 单独可复用的时间线渲染 (Drawer 也用它).
 *
 * 输入: 整份 ResearchRecord 列表; 自己做 signal-scope / round-scope 排序与节点拼接.
 * empty 状态由调用方处理 — 这里假设 totalResults > 0.
 */
export function LearningTimeline({ items }: { items?: ResearchRecord[] }) {
  const { t } = useTranslation();
  const signalScope = items?.find((r) => r.scope === "signal");
  const roundScopes = (items ?? [])
    .filter((r) => r.scope === "refinement_round")
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

  type Node = { key: string; title: string; record: ResearchRecord };
  const nodes: Node[] = [];
  if (signalScope)
    nodes.push({ key: signalScope.id, title: t("refinement.learning.nodeBackground"), record: signalScope });
  for (const r of roundScopes) {
    nodes.push({ key: r.id, title: t("refinement.learning.nodeRound", { round: r.round }), record: r });
  }
  const visibleNodes = nodes.filter((n) => n.record.results.length > 0);

  return (
    <View style={styles.timeline}>
      {visibleNodes.map((n, idx) => (
        <TimelineNode
          key={n.key}
          title={n.title}
          record={n.record}
          isFirst={idx === 0}
          isLast={idx === visibleNodes.length - 1}
        />
      ))}
    </View>
  );
}

function ExpandedBody({ items, totalResults }: { items?: ResearchRecord[]; totalResults: number }) {
  const { t } = useTranslation();
  if (totalResults === 0) {
    return (
      <View style={styles.bodyEmpty}>
        <Serif size={12} italic style={styles.emptyHint}>
          {t("refinement.learning.emptyHint")}
        </Serif>
      </View>
    );
  }

  // 复用 LearningTimeline (避免重复)
  return <LearningTimeline items={items} />;
}

/**
 * 时间线节点 —
 *   左轨: 顶到底的竖线 (首节点上半截截断, 末节点下半截截断)
 *   节点圆点: 24×24 圆环, 中心实心小点
 *   右侧: 节点标题 + 结果卡列表
 */
function TimelineNode({
  title,
  record,
  isFirst,
  isLast,
}: {
  title: string;
  record: ResearchRecord;
  isFirst: boolean;
  isLast: boolean;
}) {
  return (
    <View style={styles.node}>
      <View style={styles.rail}>
        <View style={[styles.railLine, isFirst && styles.railLineTopCut]} />
        <View style={styles.bullet}>
          <View style={styles.bulletDot} />
        </View>
        <View style={[styles.railLine, isLast && styles.railLineBotCut]} />
      </View>
      <View style={styles.nodeBody}>
        <Mono size={9} style={styles.nodeTitle}>
          {title.toUpperCase()}
        </Mono>
        <View style={styles.resultStack}>
          {record.results.map((r) =>
            r.kind === "market" && r.market ? (
              <MarketRow
                key={`${record.id}-${r.url}`}
                title={r.title}
                url={r.url}
                age={r.age}
                market={r.market}
              />
            ) : (
              <ResultRow
                key={`${record.id}-${r.url}`}
                title={r.title}
                url={r.url}
                description={r.description}
                age={r.age}
                domain={r.domain}
              />
            ),
          )}
        </View>
      </View>
    </View>
  );
}

function ResultRow({
  title,
  url,
  description,
  age,
  domain,
}: {
  title: string;
  url: string;
  description: string;
  age?: string;
  domain?: string;
}) {
  const handlePress = () => {
    if (url) Linking.openURL(url).catch(() => undefined);
  };
  return (
    <TapEffect
      style={styles.row}
      pressedStyle={{ backgroundColor: theme.color.paperPressed }}
      onPress={handlePress}
    >
      <View style={styles.rowHeader}>
        {domain ? (
          <Sans size={9} weight="600" style={styles.domain}>
            {domain.toUpperCase()}
          </Sans>
        ) : null}
        {age ? (
          <Serif size={10} italic style={styles.age}>
            {age}
          </Serif>
        ) : null}
      </View>
      <Serif size={13} style={styles.title}>
        {title}
      </Serif>
      {description ? (
        <Serif size={12} style={styles.description} numberOfLines={2}>
          {description}
        </Serif>
      ) : null}
    </TapEffect>
  );
}

/**
 * MarketRow — Polymarket 预测市场线索: 标题 + 各结果的概率条 + 成交额.
 * 点击 → 系统浏览器打开 Polymarket 事件页. 概率条用红色填充, 宽度 = 隐含概率.
 */
function MarketRow({
  title,
  url,
  age,
  market,
}: {
  title: string;
  url: string;
  age?: string;
  market: MarketData;
}) {
  const { t } = useTranslation();
  const handlePress = () => {
    if (url) Linking.openURL(url).catch(() => undefined);
  };
  const top = market.outcomes.slice(0, 4);
  return (
    <TapEffect
      style={styles.row}
      pressedStyle={{ backgroundColor: theme.color.paperPressed }}
      onPress={handlePress}
    >
      <View style={styles.rowHeader}>
        <Sans size={9} weight="600" style={styles.domain}>
          POLYMARKET
        </Sans>
        {age ? (
          <Serif size={10} italic style={styles.age}>
            {age}
          </Serif>
        ) : null}
      </View>
      <Serif size={13} style={styles.title}>
        {title}
      </Serif>
      <View style={styles.bars}>
        {top.map((o) => (
          <View key={o.label} style={styles.barRow}>
            <Serif size={11} style={styles.barLabel} numberOfLines={1}>
              {o.label}
            </Serif>
            <View style={styles.barTrack}>
              <View style={[styles.barFill, { width: `${barWidth(o.probability)}%` }]} />
            </View>
            <Mono size={10} style={styles.barPct}>
              {formatPct(o.probability)}
            </Mono>
          </View>
        ))}
      </View>
      {market.volumeUsd ? (
        <Serif size={11} italic style={styles.vol}>
          {t("refinement.learning.volume", { amount: formatUsd(market.volumeUsd) })}
        </Serif>
      ) : null}
    </TapEffect>
  );
}

/** 0.62 → "62%"; 极小/极大概率折成 "<1%" / ">99%" 避免显示 0%/100%. */
function formatPct(p: number): string {
  if (!Number.isFinite(p) || p <= 0) return "0%";
  if (p < 0.01) return "<1%";
  if (p > 0.99 && p < 1) return ">99%";
  return `${Math.round(p * 100)}%`;
}

/** 概率 → 条宽百分比, 下限 2% 让极小概率仍可见. */
function barWidth(p: number): number {
  if (!Number.isFinite(p) || p <= 0) return 2;
  return Math.max(2, Math.min(100, Math.round(p * 100)));
}

/** 成交额 → "$4.2M" / "$320K" / "$540". */
function formatUsd(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${Math.round(v)}`;
}

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing.lg,
    paddingHorizontal: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
    paddingVertical: theme.spacing.md,
  },
  diamond: {
    width: 6,
    height: 6,
    backgroundColor: theme.color.red,
    transform: [{ rotate: "45deg" }],
    alignSelf: "center",
  },
  label: {
    letterSpacing: 2,
    textTransform: "uppercase",
    color: theme.color.ink,
  },
  meta: {
    marginLeft: "auto",
    color: theme.color.muted,
  },
  bodyEmpty: {
    paddingBottom: theme.spacing.md,
  },
  emptyHint: {
    color: theme.color.muted,
  },

  // ── Timeline ──
  timeline: {
    paddingBottom: theme.spacing.md,
  },
  node: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    minHeight: 56,
  },
  rail: {
    width: 24,
    alignItems: "center",
  },
  railLine: {
    flex: 1,
    width: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.rule,
  },
  railLineTopCut: {
    backgroundColor: "transparent",
  },
  railLineBotCut: {
    backgroundColor: "transparent",
  },
  bullet: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1,
    borderColor: theme.color.ink,
    backgroundColor: theme.color.paper,
    alignItems: "center",
    justifyContent: "center",
  },
  bulletDot: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: theme.color.ink,
  },
  nodeBody: {
    flex: 1,
    paddingTop: 2,
    paddingBottom: theme.spacing.md,
  },
  nodeTitle: {
    color: theme.color.muted,
    letterSpacing: 2,
    paddingBottom: theme.spacing.xs,
  },
  resultStack: {
    // 单条结果直接平铺, 没 gap — Row 自带 border-top 做分隔
  },

  // ── Result Row ──
  row: {
    paddingVertical: theme.spacing.sm,
    paddingHorizontal: theme.spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  rowHeader: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.xxs,
  },
  domain: {
    color: theme.color.ink3,
    letterSpacing: 1.5,
  },
  age: {
    color: theme.color.muted,
  },
  title: {
    color: theme.color.ink,
    lineHeight: 20,
  },
  description: {
    color: theme.color.muted,
    lineHeight: 18,
    marginTop: 2,
  },

  // ── Market Row (Polymarket 概率条) ──
  bars: {
    marginTop: theme.spacing.xs,
    gap: 4,
  },
  barRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  barLabel: {
    width: 96,
    color: theme.color.ink,
  },
  barTrack: {
    flex: 1,
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.ruleSoft,
    overflow: "hidden",
  },
  barFill: {
    height: 6,
    borderRadius: 3,
    backgroundColor: theme.color.red,
  },
  barPct: {
    width: 40,
    textAlign: "right",
    color: theme.color.ink3,
  },
  vol: {
    marginTop: theme.spacing.xs,
    color: theme.color.muted,
  },
});
