/**
 * 档案 tab · 沉默归档 + 复盘历史.
 *
 * 顶部和收件箱共用同一个 CollapsibleMasthead — 同样的 absolute 浮层 + 滚动折叠.
 *
 * 把 4 道门归档池合并为 2 组, 每组加口语化说明:
 *   · "还在等" = observation (信号不够厚) + calendar (窗口未到)
 *   · "已经放下" = lesson (能力圈外) + discard (市场已定价)
 *
 * 下半部: 已 finalized 的复盘列表.
 *
 * 视觉: 报刊感. 不弹 toast, 不显示 "no archives 😢". 空状态用 italic 文案接纳.
 *
 * 关于 paddingBottom: NativeTabs 是 native UITabBarController + glass, 不会自动给
 * scrollview 加 bottom inset. 手动给 ScrollView 留出 tab bar (~49) + safe-area bottom
 * 的空间, 否则最后一条复盘 / pool 行会被半透明 glass tab bar 盖住.
 */

import { useMemo } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { router } from "expo-router";

import {
  CollapsibleMasthead,
  COLLAPSIBLE_MASTHEAD_EXPANDED,
  Mono,
  SectionHeader,
  Serif,
} from "@/shared/components";
import { chineseMonthDay, chineseWeekday, isoWeekOfYear } from "@/features/capture";
import { useGatePool, type GateEvaluation } from "@/features/archive";
import { useRetrospectList, type Retrospect } from "@/features/retrospect";
import type { ArchivePoolT } from "@/core/api/gate";
import { theme } from "@/core/theme";

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
    intro: "这些已经清楚 \"不进\". 留着不是为了出手, 是为了下次再遇到类似的, 能更快认出来.",
    pools: ["lesson", "discard"] as const,
    tagOf: { lesson: "圈外", discard: "已定价" },
  },
];

export default function ArchiveScreen() {
  const insets = useSafeAreaInsets();
  const today = useMemo(() => new Date(), []);
  const { data: retrospects } = useRetrospectList();
  const finalizedRetrospects = (retrospects ?? []).filter((r) => r.state === "finalized");

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const headerPad = insets.top + COLLAPSIBLE_MASTHEAD_EXPANDED;
  const bottomPad = insets.bottom + 64; // 给 NativeTabs glass bar 让出空间

  return (
    <View style={styles.root}>
      <Animated.ScrollView
        onScroll={onScroll}
        scrollEventThrottle={16}
        contentContainerStyle={{ paddingTop: headerPad, paddingBottom: bottomPad }}
      >
        <View style={styles.section}>
          <SectionHeader label="沉默归档" meta="没进承诺书的, 都在这里" />
          <Serif size={13} italic style={styles.intro}>
            想过但没出手的瞬间, 按"为什么没进"分成两类. 不丢, 也不催你.
          </Serif>
        </View>

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
      </Animated.ScrollView>

      <CollapsibleMasthead
        volume="I"
        edition={String(isoWeekOfYear(today))}
        date={chineseMonthDay(today)}
        weekday={chineseWeekday(today)}
        onMenuPress={() => router.push("/colophon")}
        onCapturePress={() => router.push("/capture")}
        scrollY={scrollY}
      />
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
  return (
    <View style={styles.poolRow}>
      <Mono size={10} style={styles.date}>
        {date}
      </Mono>
      <View style={styles.poolBody}>
        <View style={styles.poolHeadRow}>
          <Serif size={13} style={styles.poolMain}>
            门 {ev.failed_gate ?? "?"} 没过
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
      </View>
    </View>
  );
}

function RetrospectRow({ retro }: { retro: Retrospect }) {
  const date = (retro.finalized_at ?? retro.started_at).slice(0, 10).replace(/-/g, "·");
  return (
    <View style={styles.retroRow}>
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
    </View>
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
