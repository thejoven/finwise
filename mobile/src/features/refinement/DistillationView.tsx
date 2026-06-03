/**
 * DistillationView — 降噪综述 + 受益标的卡的可复用渲染.
 *
 * 用在信号详情页 (历史回看, 静态展示). 降噪页 (app/refinement/distilled/[sessionId])
 * 有自己一份带 typewriter 到达动画的渲染 —— 那是"信号异步到达"的实时体验, 与详情页
 * 的静态回看语义不同, 故暂不强行共用 (卡片样式有少量重复, 后续可统一).
 */

import { StyleSheet, View } from "react-native";

import { Mono, PaperCard, Sans, Serif } from "@/shared/components";
import { theme } from "@/core/theme";
import type { BeneficiaryTarget } from "@/core/api/distillation";

/** 降噪综述正文 — 把 distilled_content 按空行分段渲染. */
export function DistilledContent({ content }: { content: string }) {
  const paras = content
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  return (
    <View style={styles.distilledBody}>
      {paras.map((p, i) => (
        <Serif key={i} size={16} style={styles.distilledPara}>
          {p}
        </Serif>
      ))}
    </View>
  );
}

/** 单个受益标的卡. */
export function BeneficiaryTargetCard({ target }: { target: BeneficiaryTarget }) {
  return (
    <PaperCard style={styles.card}>
      <View style={styles.cardTop}>
        <Mono size={13} style={styles.symbol}>
          {target.symbol}
        </Mono>
        <Sans size={9} weight="700" style={styles.roleBadge}>
          {target.role}
        </Sans>
      </View>
      <Serif size={14} style={styles.name}>
        {target.name}
      </Serif>
      <Serif size={14} style={styles.thesis}>
        {target.thesis}
      </Serif>
      <View style={styles.metaBlock}>
        {target.valuation ? <MetaRow label="估值" value={target.valuation} /> : null}
        {target.catalyst ? <MetaRow label="催化" value={target.catalyst} /> : null}
        {target.risk ? <MetaRow label="风险" value={target.risk} danger /> : null}
      </View>
    </PaperCard>
  );
}

function MetaRow({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <View style={styles.metaRow}>
      <Sans size={9} weight="700" style={styles.metaLabel}>
        {label}
      </Sans>
      <Serif size={13} style={[styles.metaValue, danger ? styles.metaValueDanger : null]}>
        {value}
      </Serif>
    </View>
  );
}

/** 受益推演留白 (推演完无标的时). */
export function BeneficiarySilence({ note }: { note: string | null }) {
  return (
    <View style={styles.silence}>
      <Serif size={15} italic style={styles.silenceText}>
        {note || "这条信号没有清晰的受益映射。系统选择不说。"}
      </Serif>
    </View>
  );
}

const styles = StyleSheet.create({
  distilledBody: {
    marginTop: theme.spacing.md,
    gap: theme.spacing.md,
  },
  distilledPara: {
    color: theme.color.ink,
    lineHeight: 26,
  },
  card: {
    backgroundColor: theme.color.paper2,
  },
  cardTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: theme.spacing.xs,
  },
  symbol: {
    color: theme.color.ink,
    letterSpacing: 1,
  },
  roleBadge: {
    color: theme.color.paper,
    backgroundColor: theme.color.ink,
    paddingHorizontal: theme.spacing.sm,
    paddingVertical: theme.spacing.xxs,
    letterSpacing: 1,
    overflow: "hidden",
  },
  name: {
    color: theme.color.ink,
    marginBottom: theme.spacing.sm,
  },
  thesis: {
    color: theme.color.ink2,
    lineHeight: 22,
  },
  metaBlock: {
    marginTop: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    gap: theme.spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.ruleSoft,
  },
  metaRow: {
    flexDirection: "row",
    gap: theme.spacing.sm,
    alignItems: "baseline",
  },
  metaLabel: {
    color: theme.color.muted,
    letterSpacing: 1,
    textTransform: "uppercase",
    width: 32,
  },
  metaValue: {
    color: theme.color.ink2,
    flex: 1,
    lineHeight: 20,
  },
  metaValueDanger: {
    color: theme.color.red,
  },
  silence: {
    marginTop: theme.spacing.md,
    paddingVertical: theme.spacing.lg,
  },
  silenceText: {
    color: theme.color.muted,
    lineHeight: 24,
  },
});
