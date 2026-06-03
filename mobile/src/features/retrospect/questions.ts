/**
 * 复盘四问 (Phase 3 v1 客户端静态).
 *
 * Phase 3 v2 由 Mastra Diagnostician 根据 commitment 上下文动态出题. 现在 hardcode.
 * 维度顺序固定 1:perception → 2:inference → 3:evaluation → 4:execution.
 *
 * 题面与选项锚定 WiseFlow Pro Lens (与 mastra/src/agents/lens.ts 一致):
 *   - perception → L1 根因还原 + L10 叙事生命周期 (录入时你站在 narrative 哪一段)
 *   - inference  → L2 多元思维栅格 + L3 二阶思考 (链条跑到第几跳, 用了几个 lens)
 *   - evaluation → L8 安全边际 + L9 凸性 (退出条件是否能把 optionality 还原为现金)
 *   - execution  → L5 base rate (从签字到行动的犹豫成本是不是 inside view 过度自信)
 *
 * 严禁选项 / 题面里出现 "Munger" "Soros" "Buffett" 等人名. 用产品语言.
 */

import type { RetrospectDimT } from "@/core/api/retrospect";

export interface RetrospectQuestion {
  no: 1 | 2 | 3 | 4;
  dim: RetrospectDimT;
  title: string;
  /** 选项. id 短码, label 给用户看的文案. */
  options: Array<{ id: string; label: string }>;
  /** 选完是否再写一句话. */
  openPrompt?: string;
}

export const RETROSPECT_QUESTIONS: RetrospectQuestion[] = [
  {
    no: 1,
    dim: "perception",
    title: "你录到这条信号时, 它在叙事生命周期的哪一段?",
    options: [
      { id: "pre_narrative", label: "沉默期 · 圈外没人在说, 我是被噪音以外的物理变量触发的" },
      { id: "early", label: "早期 leading · 圈内人开始低声讨论, 主流媒体还没覆盖" },
      { id: "mid", label: "中段扩散 · sell-side 开始出报告, 但分歧仍在" },
      { id: "late", label: "晚期共识 · 头条 / retail 都在讨论, 我录得已经晚了" },
    ],
    openPrompt: "你判断这一阶段的依据是什么? (具体到一两个信号, 不写'感觉')",
  },
  {
    no: 2,
    dim: "inference",
    title: "你的推演链跑到第几跳? 用了哪几个 lens?",
    options: [
      { id: "first_one_lens", label: "一阶 · 单 lens · 谁明显受益 (停在表层, 多元思维栅格没展开)" },
      {
        id: "second_one_lens",
        label: "二阶 · 单 lens · 谁因此被迫让步 (有二阶, 但只用了金融或商业)",
      },
      {
        id: "third_multi_lens",
        label: "三阶 · 多 lens · 跨学科 (法律 / 工程 / 博弈 / 历史) 交叉看到了反共识的赢家",
      },
      { id: "wavered", label: "中途自己说服自己回退了 — 链跑出来了, 但又自我否决" },
    ],
    openPrompt:
      "如果重来, 你会用哪个之前漏掉的 lens? (心理学 / 法律 / 历史 / 博弈论 / 生物学 / 工程 / 化学 / 物理 / 数学 中挑一个)",
  },
  {
    no: 3,
    dim: "evaluation",
    title: "你的退出条件能把这个仓位的'凸性'还原成现金吗?",
    options: [
      { id: "specific_anchored", label: "可以 · 三锚齐全: 价格锚 + 时间锚 + 一条外部可观察信号" },
      { id: "price_only", label: "半套 · 只有价格止损, 没有 intrinsic 安全边际, 一砸就空" },
      { id: "vague", label: "空的 · 写了也是 '看情况', 凸性根本兑现不了" },
      {
        id: "wrong_kind",
        label: "错型 · 这个仓位本就不该用退出条件 (本质是 hedge / pair / 长期 own)",
      },
    ],
    openPrompt: "下一次写退出条件, 你的三锚分别会是什么? (price + time + external)",
  },
  {
    no: 4,
    dim: "execution",
    title: "从签字到行动, 你的犹豫成本来自哪里?",
    options: [
      { id: "same_day", label: "签字当天 · 立刻执行, 没犹豫" },
      { id: "within_week", label: "一周内 · 走了一遍 base rate 校准才动" },
      { id: "weeks_later", label: "拖了几周 · inside view 过度自信被反复推翻才动" },
      { id: "never", label: "签了字但没真做 · 命题与持仓断裂" },
    ],
    openPrompt:
      "如果有犹豫, 你在反复检查的是哪个 lens? (是 base rate 不放心, 还是反身性时机判断, 还是别的)",
  },
];
