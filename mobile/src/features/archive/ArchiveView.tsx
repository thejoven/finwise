/**
 * 归档 · 财知页第三张子页 · 沉默归档 + 复盘历史.
 *
 * 排版: 模块化卡片. 每条归档 = 一张"分析师便签"卡 —
 *   卡头 (日期 + 来源 pill) → 信号上下文一行 → 分析师署名 → 否决理由以
 *   **对话气泡**口吻呈现 → 卡脚"继续对话"指引.
 * 点卡片 → /archive/chat/[id], 与否决这条的分析师继续聊 (评估不改判, 只解释).
 *
 * 分组不变: 投决会四池合并为 2 组 ("还在等" = observation+calendar,
 * "已经放下" = lesson+discard), 每组口语化说明. 下半部: 已 finalized 的复盘.
 *
 * 与旧 archive 屏唯一区别: 报头已上移到财知 host 的固定 CaizhiHeader, 本视图不再自带
 *   CollapsibleMasthead. 作为 PagerView 一页, 顶部紧接吸顶分段栏 (留一点呼吸), 底部留
 *   insets.bottom + TAB_BAR_CLEARANCE 给悬浮的灵动岛 tab bar 让位.
 *
 * 视觉: 报刊感. 不弹 toast, 不显示 "no archives 😢". 空状态用 italic 文案接纳.
 */

import { useMemo } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import Animated from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Icon,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TAB_BAR_CLEARANCE,
  TapEffect,
} from "@/shared/components";
// 走具体文件而非 "@/features/archive" barrel: 该 barrel 同时导出本组件, 走 barrel 会形成
// archive/index ⇄ ArchiveView 的自引用 require cycle. 具体路径切断回边.
import { useGatePool, type GateEvaluation } from "@/features/archive/hooks";
import { useRetrospectList, type Retrospect } from "@/features/retrospect";
import {
  analystByGate,
  analystName,
  analystRole,
  gateVerdictText,
  type ArchivePoolT,
} from "@/core/api/gate";
import { theme } from "@/core/theme";
import i18n from "@/core/i18n";
import { LIST_LAYOUT } from "@/shared/motion";

// 两个语义组. 每组合并多个底层 pool, 用一句口语说人话.
// pools 定为 [A, B] 定长元组, 让 GroupSection 里两次 useGatePool 顺序固定 (rules-of-hooks).
// 文案走 i18n: id 定位 archive.groups.<id>.*; tagKeys 给每个 pool 一个完整 i18n key.
/** 卡头小标签的完整 i18n key (字面量, 让 t() 仍受类型检查). */
type TagI18nKey =
  | "archive.groups.waiting.tagObservation"
  | "archive.groups.waiting.tagCalendar"
  | "archive.groups.letGo.tagLesson"
  | "archive.groups.letGo.tagDiscard";

interface PoolGroup {
  /** i18n 组 id: archive.groups.<id>.{label,meta,intro} */
  id: "waiting" | "letGo";
  pools: readonly [ArchivePoolT, ArchivePoolT];
  /** 每个 pool 的小标签完整 i18n key, 卡头右侧露出, 提示来源 */
  tagKeys: Partial<Record<ArchivePoolT, TagI18nKey>>;
}

const GROUPS: PoolGroup[] = [
  {
    id: "waiting",
    pools: ["observation", "calendar"] as const,
    tagKeys: {
      observation: "archive.groups.waiting.tagObservation",
      calendar: "archive.groups.waiting.tagCalendar",
    },
  },
  {
    id: "letGo",
    pools: ["lesson", "discard"] as const,
    tagKeys: {
      lesson: "archive.groups.letGo.tagLesson",
      discard: "archive.groups.letGo.tagDiscard",
    },
  },
];

export function ArchiveView() {
  const insets = useSafeAreaInsets();
  const { t } = useTranslation();
  const { data: retrospects } = useRetrospectList();
  const finalizedRetrospects = (retrospects ?? []).filter((r) => r.state === "finalized");

  return (
    <View style={styles.root}>
      <ScrollView
        // 这是带固定段落的滚动页 (非重排列表), 底部安全区 padding 只随旋转/安全区变化 (极少),
        // contentInset 是 iOS-only 且语义不同, 故此处保留 contentContainerStyle padding.
        contentContainerStyle={{
          // react-doctor-disable-next-line react-doctor/rn-scrollview-dynamic-padding
          paddingTop: theme.spacing.md,
          paddingBottom: insets.bottom + TAB_BAR_CLEARANCE,
        }}
      >
        <View style={styles.section}>
          <SectionHeader label={t("archive.header.label")} meta={t("archive.header.meta")} />
          <Serif size={13} italic style={styles.intro}>
            {t("archive.header.intro")}
          </Serif>
        </View>

        {/* GROUPS 是静态的 2 项模块常量, 整页是带异构段落的滚动页 (非长列表) —— ScrollView 正确. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {GROUPS.map((g) => (
          <GroupSection key={g.id} group={g} />
        ))}

        <View style={styles.section}>
          <SectionHeader label={t("archive.retrospect.label")} meta={t("archive.retrospect.meta")} />
          {finalizedRetrospects.length === 0 ? (
            <Serif size={13} italic style={styles.muted}>
              {t("archive.retrospect.empty")}
            </Serif>
          ) : (
            <View style={styles.cardList}>
              {finalizedRetrospects.map((r) => (
                <RetrospectCard key={r.id} retro={r} />
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}

function GroupSection({ group }: { group: PoolGroup }) {
  // 并行拉该组下两个 pool, 合并 + 时间倒序.
  // hooks 顺序在渲染期固定 (GROUPS 静态常量, pools 定长元组), 不违反 rules-of-hooks.
  const { t } = useTranslation();
  const [poolA, poolB] = group.pools;
  const a = useGatePool(poolA);
  const b = useGatePool(poolB);

  const items = useMemo(() => {
    const merged: Array<GateEvaluation & { _pool: ArchivePoolT }> = [];
    (a.data ?? []).forEach((ev) => merged.push({ ...ev, _pool: poolA }));
    (b.data ?? []).forEach((ev) => merged.push({ ...ev, _pool: poolB }));
    merged.sort((x, y) => (y.evaluated_at > x.evaluated_at ? 1 : -1));
    return merged;
  }, [a.data, b.data, poolA, poolB]);

  const isLoading = a.isLoading || b.isLoading;
  const cap = 6;

  const groupMeta = t(`archive.groups.${group.id}.meta`);

  return (
    <View style={styles.section}>
      <SectionHeader
        label={t(`archive.groups.${group.id}.label`)}
        meta={t("archive.groups.count", { count: items.length, meta: groupMeta })}
      />
      <Serif size={12} italic style={styles.groupIntro}>
        {t(`archive.groups.${group.id}.intro`)}
      </Serif>
      {isLoading && items.length === 0 ? (
        <Serif size={12} italic style={styles.muted}>
          ...
        </Serif>
      ) : items.length === 0 ? (
        <Serif size={12} italic style={styles.muted}>
          {t("archive.groups.empty")}
        </Serif>
      ) : (
        <View style={styles.cardList}>
          {items.slice(0, cap).map((ev) => {
            const tagKey = group.tagKeys[ev._pool];
            return <PoolCard key={ev.id} ev={ev} tag={tagKey ? t(tagKey) : ""} />;
          })}
          {items.length > cap ? (
            <Mono size={10} style={styles.more}>
              {t("archive.groups.more", { count: items.length - cap })}
            </Mono>
          ) : null}
        </View>
      )}
    </View>
  );
}

/**
 * PoolCard — 一条归档评估的"分析师便签"模块卡.
 * 否决理由以分析师第一人称的气泡呈现; 点整卡进入对话页继续聊.
 */
function PoolCard({ ev, tag }: { ev: GateEvaluation; tag: string }) {
  const { t } = useTranslation();
  const analyst = analystByGate(ev.failed_gate);
  const date = ev.evaluated_at.slice(0, 10).replace(/-/g, "·");
  const verdict = gateVerdictText(ev);
  // 共识分析师指的"未被定价的方向" (多在 discard 池) — 死路改成往哪看. 卡片列 angle, 对话页给全文.
  const directions = ev.gates.g2_anti_consensus.unpriced_directions ?? [];
  const signalLine = ev.signal?.summary || "";
  const asset = ev.signal?.asset ?? "";

  return (
    <Animated.View layout={LIST_LAYOUT}>
      <TapEffect
        style={styles.card}
        pressedStyle={{ backgroundColor: theme.color.paper3 }}
        onPress={() => router.push(`/archive/chat/${ev.id}`)}
      >
        {/* 卡头: 日期 + 来源 pill */}
        <View style={styles.cardHead}>
          <Mono size={9} style={styles.date}>
            {date}
          </Mono>
          {tag ? (
            <View style={styles.tagPill}>
              <Mono size={9} style={styles.tagText}>
                {tag}
              </Mono>
            </View>
          ) : null}
        </View>

        {/* 信号上下文: 这条被拦的是什么 */}
        {asset || signalLine ? (
          <View style={styles.signalRow}>
            {asset ? (
              <Mono size={11} style={styles.signalAsset}>
                {asset}
              </Mono>
            ) : null}
            {signalLine ? (
              <Serif size={12} numberOfLines={1} style={styles.signalSummary}>
                {signalLine}
              </Serif>
            ) : null}
          </View>
        ) : null}

        {/* 分析师署名 + 对话气泡 */}
        <View style={styles.analystRow}>
          <View style={styles.seal}>
            <Sans size={10} weight="700" style={styles.sealText}>
              {(analyst ? analystName(analyst) : t("archive.card.sealFallback")).slice(0, 1)}
            </Sans>
          </View>
          <Sans size={12} weight="600" style={styles.analystName}>
            {analystName(analyst)}
          </Sans>
          <Serif size={11} italic style={styles.analystRole}>
            {analystRole(analyst)}
          </Serif>
        </View>
        <View style={styles.bubble}>
          <Serif size={13} style={styles.bubbleText}>
            {verdict}
          </Serif>
          {directions.length > 0 ? (
            <Serif size={12} italic style={styles.bubbleDirections}>
              {t("archive.card.unpricedDirections", {
                directions: directions.map((d) => d.angle).join(" · "),
              })}
            </Serif>
          ) : null}
        </View>

        {/* 卡脚: 继续对话指引 */}
        <View style={styles.cardFoot}>
          <Mono size={9} style={styles.footHint}>
            {t("archive.card.continue")}
          </Mono>
          <Icon name="chevronRight" size={11} color={theme.color.muted} strokeWidth={1.5} />
        </View>
      </TapEffect>
    </Animated.View>
  );
}

function RetrospectCard({ retro }: { retro: Retrospect }) {
  const date = (retro.finalized_at ?? retro.started_at).slice(0, 10).replace(/-/g, "·");
  return (
    <Animated.View layout={LIST_LAYOUT}>
      <View style={styles.card}>
        <View style={styles.cardHead}>
          <Mono size={9} style={styles.date}>
            {date}
          </Mono>
          <View style={styles.tagPill}>
            <Mono size={9} style={styles.tagText}>
              {focusDimLabel(retro.focus_dim ?? "")}
            </Mono>
          </View>
        </View>
        <Serif size={13} italic style={styles.retroText}>
          {retro.focus_text ?? i18n.t("archive.retrospect.none")}
        </Serif>
      </View>
    </Animated.View>
  );
}

// ───── helpers ─────

function focusDimLabel(d: string): string {
  switch (d) {
    case "perception_speed":
      return i18n.t("archive.retrospect.dim.perceptionSpeed");
    case "inference_depth":
      return i18n.t("archive.retrospect.dim.inferenceDepth");
    case "decision_speed":
      return i18n.t("archive.retrospect.dim.decisionSpeed");
    case "holding_patience":
      return i18n.t("archive.retrospect.dim.holdingPatience");
    case "exit_quality":
      return i18n.t("archive.retrospect.dim.exitQuality");
    case "thesis_evolution":
      return i18n.t("archive.retrospect.dim.thesisEvolution");
    default:
      return d || i18n.t("archive.retrospect.dim.unset");
  }
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: theme.color.paper },
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
    gap: theme.spacing.sm,
  },
  intro: { color: theme.color.muted, marginTop: 2 },
  groupIntro: {
    color: theme.color.muted,
    lineHeight: 20,
    marginTop: 2,
    marginBottom: theme.spacing.xs,
  },
  muted: { color: theme.color.muted, marginTop: theme.spacing.xs },
  cardList: { gap: theme.spacing.md, marginTop: theme.spacing.xs },

  // ── 模块卡 ──
  card: {
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  date: { color: theme.color.muted, letterSpacing: 1 },
  tagPill: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.muted,
    paddingHorizontal: 6,
    paddingVertical: 1,
  },
  tagText: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  signalRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  signalAsset: { color: theme.color.ink, letterSpacing: 0.5 },
  signalSummary: { color: theme.color.muted, flex: 1 },

  analystRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  // 方形小印章 — 分析师"署名". 报刊感, 不做圆头像.
  seal: {
    width: 18,
    height: 18,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.color.ink,
  },
  sealText: { color: theme.color.paper },
  analystName: { color: theme.color.ink },
  analystRole: { color: theme.color.muted2, flex: 1 },

  // 对话气泡: 纸面 + 左侧 2px ink 竖条, "他说的话"
  bubble: {
    backgroundColor: theme.color.paper,
    borderLeftWidth: 2,
    borderLeftColor: theme.color.ink,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.xs,
  },
  bubbleText: { color: theme.color.ink2, lineHeight: 20 },
  bubbleDirections: { color: theme.color.ink, lineHeight: 18 },

  cardFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
  },
  footHint: { color: theme.color.muted, letterSpacing: 1 },

  retroText: { color: theme.color.ink2, lineHeight: 20 },
  more: { color: theme.color.muted2, marginTop: 4 },
});
