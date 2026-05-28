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
import { ChevronDown, ChevronUp } from "lucide-react-native";

import { Mono, Sans, Serif, TapEffect } from "@/shared/components";
import { theme } from "@/core/theme";
import type { ResearchRecord } from "@/core/api/research";

export interface LearningCardProps {
  items?: ResearchRecord[]; // undefined = 还在拉; [] = 拉到了但空
  loading: boolean;
  /** 初始是否展开. 默认 false (折叠) — 不抢用户题目焦点. */
  defaultExpanded?: boolean;
}

export function LearningCard({ items, loading, defaultExpanded = false }: LearningCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);

  const totalResults = (items ?? []).reduce((acc, r) => acc + r.results.length, 0);
  const statusMeta = computeStatusMeta({ items, loading, totalResults });

  return (
    <View style={styles.container}>
      <TapEffect
        style={styles.header}
        pressedStyle={{ backgroundColor: theme.color.paperPressed }}
        onPress={() => setExpanded((v) => !v)}
      >
        <View style={styles.diamond} />
        <Sans size={10} weight="700" style={styles.label}>
          相关线索
        </Sans>
        <Serif size={10} italic style={styles.meta}>
          {statusMeta}
        </Serif>
        {statusMeta && totalResults > 0 ? (
          expanded ? (
            <ChevronUp size={14} color={theme.color.muted} strokeWidth={1.5} />
          ) : (
            <ChevronDown size={14} color={theme.color.muted} strokeWidth={1.5} />
          )
        ) : null}
      </TapEffect>

      {expanded ? <ExpandedBody items={items} totalResults={totalResults} /> : null}
    </View>
  );
}

function computeStatusMeta({
  items,
  loading,
  totalResults,
}: {
  items?: ResearchRecord[];
  loading: boolean;
  totalResults: number;
}): string {
  if (totalResults > 0) return `${totalResults} 条来源`;
  if (!items && loading) return "加载中…";
  return "未检索到外部资料";
}

/**
 * LearningTimeline — 单独可复用的时间线渲染 (Drawer 也用它).
 *
 * 输入: 整份 ResearchRecord 列表; 自己做 signal-scope / round-scope 排序与节点拼接.
 * empty 状态由调用方处理 — 这里假设 totalResults > 0.
 */
export function LearningTimeline({ items }: { items?: ResearchRecord[] }) {
  const signalScope = items?.find((r) => r.scope === "signal");
  const roundScopes = (items ?? [])
    .filter((r) => r.scope === "refinement_round")
    .sort((a, b) => (a.round ?? 0) - (b.round ?? 0));

  type Node = { key: string; title: string; record: ResearchRecord };
  const nodes: Node[] = [];
  if (signalScope) nodes.push({ key: signalScope.id, title: "背景检索", record: signalScope });
  for (const r of roundScopes) {
    nodes.push({ key: r.id, title: `本轮线索 · R${r.round}`, record: r });
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
  if (totalResults === 0) {
    return (
      <View style={styles.bodyEmpty}>
        <Serif size={12} italic style={styles.emptyHint}>
          这条信号没找到匹配的外部新闻 — 推演会直接用你写下的原文.
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
          {record.results.map((r, idx) => (
            <ResultRow
              key={`${record.id}-${idx}`}
              title={r.title}
              url={r.url}
              description={r.description}
              age={r.age}
              domain={r.domain}
            />
          ))}
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
});
