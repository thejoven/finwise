/**
 * 四道门反馈卡 — signal 详情页底部.
 *
 * 状态:
 *   · 还没评估 (refinement 完成后异步触发, 可能滞后几秒) → 显示 "等待评估"
 *   · 评估完成且通过 → 四道门全 ✓ + 一句 "已进入承诺书草案"
 *   · 评估完成但失败 → 失败那道门 ✗ + 该门 detail; 其它门按 pass 标 ✓
 *
 * 不在产品哲学里催促用户复盘失败 — 只是把"为什么没进"摆出来.
 */

import { StyleSheet, View } from "react-native";

import { Mono, Sans, Serif, SectionHeader } from "@/shared/components";
import { theme } from "@/core/theme";
import type { GateEvaluation } from "@/core/api/gate";

interface GateFeedbackProps {
  /** undefined = 还没拉到 / 还没评估; null 也算 "还没". 评估完成的对象在这里 */
  evaluation: GateEvaluation | null | undefined;
  /** 上游知道当前 refinement 已完成, 但还没拿到 evaluation — 用这个判断显示 "等待评估" 还是不显示整块 */
  refinementCompleted: boolean;
}

const GATE_META = [
  { id: 1 as const, label: "G1 · 厚度", hint: "信号是否足够厚" },
  { id: 2 as const, label: "G2 · 反共识", hint: "市场是否已定价" },
  { id: 3 as const, label: "G3 · 窗口", hint: "时机是否合适" },
  { id: 4 as const, label: "G4 · 能力圈", hint: "你是否能解释" },
];

export function GateFeedback({ evaluation, refinementCompleted }: GateFeedbackProps) {
  if (!refinementCompleted) return null;

  if (!evaluation) {
    return (
      <View style={styles.container}>
        <SectionHeader label="四道门" meta="等待评估" />
        <Serif size={12} italic style={styles.muted}>
          追问完成后, 后台会跑四道门评估. 通常在一两分钟内出结果.
        </Serif>
      </View>
    );
  }

  const failedGate = evaluation.failed_gate ?? null;
  const passedAll = evaluation.passed;

  return (
    <View style={styles.container}>
      <SectionHeader
        label="四道门"
        meta={passedAll ? "已通过 · 进入承诺书草案" : `第 ${failedGate} 道没过`}
      />

      <View style={styles.list}>
        {GATE_META.map((g) => {
          const status = gateStatus(g.id, evaluation);
          const detail = gateDetailText(g.id, evaluation);
          return (
            <View key={g.id} style={styles.row}>
              <View style={[styles.icon, statusStyle(status)]}>
                <Mono size={11} style={[styles.iconText, statusIconColor(status)]}>
                  {status === "pass" ? "✓" : status === "fail" ? "✗" : "·"}
                </Mono>
              </View>
              <View style={styles.body}>
                <View style={styles.headRow}>
                  <Sans size={12} weight="600" style={styles.label}>
                    {g.label}
                  </Sans>
                  <Serif size={11} italic style={styles.hint}>
                    {g.hint}
                  </Serif>
                </View>
                {detail ? (
                  <Serif
                    size={12}
                    italic={status !== "fail"}
                    style={status === "fail" ? styles.failDetail : styles.detail}
                  >
                    {detail}
                  </Serif>
                ) : null}
              </View>
            </View>
          );
        })}
      </View>
    </View>
  );
}

// ── helpers ──

type GateStatus = "pass" | "fail" | "skipped";

function gateStatus(gateId: 1 | 2 | 3 | 4, ev: GateEvaluation): GateStatus {
  // 失败那道门标 fail, 失败之后的门没跑算 skipped, 之前的都是 pass.
  const failed = ev.failed_gate ?? null;
  if (failed === null) return "pass";
  if (gateId < failed) return "pass";
  if (gateId === failed) return "fail";
  return "skipped";
}

function gateDetailText(gateId: 1 | 2 | 3 | 4, ev: GateEvaluation): string {
  const g = ev.gates;
  switch (gateId) {
    case 1:
      return g.g1_thickness.detail ?? `${g.g1_thickness.count} 条相关信号`;
    case 2:
      return g.g2_anti_consensus.detail ?? `共识分 ${g.g2_anti_consensus.score.toFixed(2)}`;
    case 3:
      return g.g3_window.detail ?? `窗口 ${g.g3_window.months} 个月`;
    case 4: {
      if (g.g4_edge.detail) return g.g4_edge.detail;
      const s = g.g4_edge.sub;
      const checks = [
        s.explain ? "讲得清" : null,
        s.direct ? "亲历" : null,
        s.track_record ? "有 track" : null,
        s.exit_known ? "知退" : null,
      ].filter(Boolean);
      return checks.length > 0 ? checks.join(" · ") : "";
    }
  }
}

function statusStyle(s: GateStatus) {
  if (s === "pass") return { borderColor: theme.color.green, backgroundColor: theme.color.paper };
  if (s === "fail") return { borderColor: theme.color.red, backgroundColor: theme.color.redSoft };
  return { borderColor: theme.color.muted2, backgroundColor: theme.color.paper };
}

function statusIconColor(s: GateStatus) {
  if (s === "pass") return { color: theme.color.green };
  if (s === "fail") return { color: theme.color.red };
  return { color: theme.color.muted2 };
}

const styles = StyleSheet.create({
  container: {
    marginTop: theme.spacing.xl,
    paddingTop: theme.spacing.md,
    paddingHorizontal: theme.spacing.lg,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.color.rule,
    gap: theme.spacing.sm,
  },
  muted: {
    color: theme.color.muted,
    marginTop: 2,
  },
  list: {
    marginTop: theme.spacing.xs,
    gap: theme.spacing.md,
  },
  row: {
    flexDirection: "row",
    gap: theme.spacing.md,
    alignItems: "flex-start",
  },
  icon: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 2,
  },
  iconText: {
    fontSize: 12,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  headRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: theme.spacing.sm,
  },
  label: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  hint: {
    color: theme.color.muted,
  },
  detail: {
    color: theme.color.muted,
    lineHeight: 18,
  },
  failDetail: {
    color: theme.color.red,
    lineHeight: 18,
  },
});
