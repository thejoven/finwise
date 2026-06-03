/**
 * 分析师审核团 · 命名与职能登记表 (替代抽象的"四道门").
 *
 * 产品层不再说"门 1 / 门 2", 而是四位各司其职的分析师轮流审一条信号:
 *
 *   thickness  → 佐证分析师   证据够不够厚、够不够独立?      (原 G1 信号厚度)
 *   consensus  → 共识分析师   市场是不是已经都知道、都定价了?  (原 G2 反共识)
 *   timing     → 时机分析师   现在出手是不是太早或太晚?       (原 G3 时间窗口)
 *   competence → 能力圈分析师 你凭什么比市场更懂这件事?       (原 G4 能力圈)
 *
 * 这张表是 prompt / 文案的单一事实源 (Go / mobile / docs 各有同名副本, 保持一致).
 * 内部数据结构 (gate_evaluations.gates_detail 的 g1..g4 键) 维持不变 — 只换"概念外衣",
 * 不动 DB schema.
 *
 * 重要约束 (同 lens.ts): 面向用户的分析师名字用产品语言, 不出现 "Munger" "Soros" 等人名.
 */

export type AnalystCode = "thickness" | "consensus" | "timing" | "competence";

export interface AnalystMeta {
  code: AnalystCode;
  /** 原"门"序号 (1..4), 与 gates_detail / failed_gate 对齐 */
  gate: 1 | 2 | 3 | 4;
  /** gates_detail JSONB 里的内部键 */
  detailKey: "g1_thickness" | "g2_anti_consensus" | "g3_window" | "g4_edge";
  /** 用户看到的分析师名 */
  name: string;
  /** 这位分析师只回答的那一个问题 */
  question: string;
  /** 失败时这条信号去哪个沉默归档池 */
  pool: "observation" | "discard" | "calendar" | "lesson";
}

export const ANALYSTS: Record<AnalystCode, AnalystMeta> = {
  thickness: {
    code: "thickness",
    gate: 1,
    detailKey: "g1_thickness",
    name: "佐证分析师",
    question: "证据够不够厚、够不够独立?",
    pool: "observation",
  },
  consensus: {
    code: "consensus",
    gate: 2,
    detailKey: "g2_anti_consensus",
    name: "共识分析师",
    question: "市场是不是已经都知道、都定价了?",
    pool: "discard",
  },
  timing: {
    code: "timing",
    gate: 3,
    detailKey: "g3_window",
    name: "时机分析师",
    question: "现在出手是不是太早或太晚?",
    pool: "calendar",
  },
  competence: {
    code: "competence",
    gate: 4,
    detailKey: "g4_edge",
    name: "能力圈分析师",
    question: "你凭什么比市场更懂这件事?",
    pool: "lesson",
  },
};

export function analystByGate(gate: number): AnalystMeta | undefined {
  return Object.values(ANALYSTS).find((a) => a.gate === gate);
}
