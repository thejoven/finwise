/**
 * 归档 · 财知页第三张子页 · 沉默归档 + 复盘历史.
 *
 * 把投决会四位分析师的归档池合并为 2 组, 每组加口语化说明:
 *   · "还在等" = observation (信号不够厚) + calendar (窗口未到)
 *   · "已经放下" = lesson (能力圈外) + discard (市场已定价)
 * 下半部: 已 finalized 的复盘列表.
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

import { Mono, SectionHeader, Serif, TAB_BAR_CLEARANCE } from "@/shared/components";
// 走具体文件而非 "@/features/archive" barrel: 该 barrel 同时导出本组件, 走 barrel 会形成
// archive/index ⇄ ArchiveView 的自引用 require cycle. 具体路径切断回边.
import { useGatePool, type GateEvaluation } from "@/features/archive/hooks";
import { useRetrospectList, type Retrospect } from "@/features/retrospect";
import { analystByGate, type ArchivePoolT } from "@/core/api/gate";
import { theme } from "@/core/theme";
import { LIST_LAYOUT } from "@/shared/motion";

// 两个语义组. 每组合并多个底层 pool, 用一句口语说人话.
// pools 定为 [A, B] 定长元组, 让 GroupSection 里两次 useGatePool 顺序固定 (rules-of-hooks).
interface PoolGroup {
  label: string;
  meta: string;
  intro: string;
  pools: readonly [ArchivePoolT, ArchivePoolT];
  /** 每个 pool 的小标签, 列表项右侧露出, 提示来源 */
  tagOf: Partial<Record<ArchivePoolT, string>>;
}

const GROUPS: PoolGroup[] = [
  {
    label: "还在等",
    meta: "等信号变厚 · 等窗口到来",
    intro: "信号还不够确凿, 或时机还没到. 我们不丢, 也不替你下决定 — 你想看的时候来翻翻.",
    pools: ["observation", "calendar"] as const,
    tagOf: { observation: "信号", calendar: "时机" },
  },
  {
    label: "已经放下",
    meta: "能力圈外 · 市场已定价",
    intro: '这些已经清楚 "不进". 留着不是为了出手, 是为了下次再遇到类似的, 能更快认出来.',
    pools: ["lesson", "discard"] as const,
    tagOf: { lesson: "圈外", discard: "已定价" },
  },
];

export function ArchiveView() {
  const insets = useSafeAreaInsets();
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
          <SectionHeader label="沉默归档" meta="没进承诺书的, 都在这里" />
          <Serif size={13} italic style={styles.intro}>
            想过但没出手的瞬间, 按"为什么没进"分成两类. 不丢, 也不催你.
          </Serif>
        </View>

        {/* GROUPS 是静态的 2 项模块常量, 整页是带异构段落的滚动页 (非长列表) —— ScrollView 正确. */}
        {/* react-doctor-disable-next-line react-doctor/rn-no-scrollview-mapped-list */}
        {GROUPS.map((g) => (
          <GroupSection key={g.label} group={g} />
        ))}

        <View style={styles.section}>
          <SectionHeader label="复盘" meta="过去你说过什么" />
          {finalizedRetrospects.length === 0 ? (
            <Serif size={13} italic style={styles.muted}>
              还没有复盘完成. 持仓到期或主动平仓后会自动生成.
            </Serif>
          ) : (
            <View style={styles.retroList}>
              {finalizedRetrospects.map((r) => (
                <RetrospectRow key={r.id} retro={r} />
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

  return (
    <View style={styles.section}>
      <SectionHeader label={group.label} meta={`${items.length} 条 · ${group.meta}`} />
      <Serif size={12} italic style={styles.groupIntro}>
        {group.intro}
      </Serif>
      {isLoading && items.length === 0 ? (
        <Serif size={12} italic style={styles.muted}>
          ...
        </Serif>
      ) : items.length === 0 ? (
        <Serif size={12} italic style={styles.muted}>
          这一类目前是空的, 这是常态.
        </Serif>
      ) : (
        <View style={styles.poolList}>
          {items.slice(0, cap).map((ev) => (
            <PoolRow key={ev.id} ev={ev} tag={group.tagOf[ev._pool] ?? ""} />
          ))}
          {items.length > cap ? (
            <Mono size={10} style={styles.more}>
              · 还有 {items.length - cap} 条
            </Mono>
          ) : null}
        </View>
      )}
    </View>
  );
}

function PoolRow({ ev, tag }: { ev: GateEvaluation; tag: string }) {
  const date = ev.evaluated_at.slice(0, 10).replace(/-/g, "·");
  const detail = poolDetail(ev);
  // 共识分析师指的"未被定价的方向" (多在 discard 池) — 死路改成往哪看. 列表里只列 angle, 详情页给全文.
  const directions = ev.gates.g2_anti_consensus.unpriced_directions ?? [];
  return (
    <Animated.View style={styles.poolRow} layout={LIST_LAYOUT}>
      <Mono size={10} style={styles.date}>
        {date}
      </Mono>
      <View style={styles.poolBody}>
        <View style={styles.poolHeadRow}>
          <Serif size={13} style={styles.poolMain}>
            {analystByGate(ev.failed_gate)?.name ?? "分析师"}没通过
          </Serif>
          {tag ? (
            <View style={styles.tagPill}>
              <Mono size={9} style={styles.tagText}>
                {tag}
              </Mono>
            </View>
          ) : null}
        </View>
        {detail ? (
          <Serif size={12} italic style={styles.poolDetail}>
            {detail}
          </Serif>
        ) : null}
        {directions.length > 0 ? (
          <Serif size={12} italic style={styles.poolDirections}>
            未被定价的方向: {directions.map((d) => d.angle).join(" · ")}
          </Serif>
        ) : null}
      </View>
    </Animated.View>
  );
}

function RetrospectRow({ retro }: { retro: Retrospect }) {
  const date = (retro.finalized_at ?? retro.started_at).slice(0, 10).replace(/-/g, "·");
  return (
    <Animated.View style={styles.retroRow} layout={LIST_LAYOUT}>
      <Mono size={10} style={styles.date}>
        {date}
      </Mono>
      <View style={styles.poolBody}>
        <Serif size={13} style={styles.retroDim}>
          {focusDimLabel(retro.focus_dim ?? "")}
        </Serif>
        <Serif size={13} italic style={styles.retroText}>
          {retro.focus_text ?? "(无)"}
        </Serif>
      </View>
    </Animated.View>
  );
}

// ───── helpers ─────

function poolDetail(ev: GateEvaluation): string {
  const g = ev.failed_gate;
  if (g === 1) return ev.gates.g1_thickness.detail ?? "信号厚度不足";
  if (g === 2) return ev.gates.g2_anti_consensus.detail ?? "已被市场充分定价";
  if (g === 3) return ev.gates.g3_window.detail ?? "窗口期不合适";
  if (g === 4) return ev.gates.g4_edge.detail ?? "在能力圈外";
  return "";
}

function focusDimLabel(d: string): string {
  switch (d) {
    case "perception_speed":
      return "录入速度";
    case "inference_depth":
      return "推演深度";
    case "decision_speed":
      return "决策速度";
    case "holding_patience":
      return "持仓耐心";
    case "exit_quality":
      return "退出质量";
    case "thesis_evolution":
      return "命题演化";
    default:
      return d || "(未定)";
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
  poolList: { gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  poolRow: { flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" },
  poolBody: { flex: 1, gap: 2 },
  poolHeadRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  poolMain: { color: theme.color.ink },
  poolDetail: { color: theme.color.muted, lineHeight: 18 },
  poolDirections: { color: theme.color.ink, lineHeight: 18, marginTop: theme.spacing.xs },
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
  date: { color: theme.color.muted, width: 64, paddingTop: 4, letterSpacing: 1 },
  more: { color: theme.color.muted2, paddingLeft: 76, marginTop: 4 },
  retroList: { gap: theme.spacing.sm, marginTop: theme.spacing.xs },
  retroRow: { flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" },
  retroDim: { color: theme.color.ink },
  retroText: { color: theme.color.muted, lineHeight: 20 },
});
