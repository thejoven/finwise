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

import i18n from "@/core/i18n";
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

/**
 * 四问的结构骨架 (no / dim / 选项 id), 与显示文案分离.
 * 文案走 i18n: 用 question 序号 + 选项 id 作 key, 在 getRetrospectQuestions 里按当前语言解析,
 * 故语言切换后重新取一次即更新 (静态 i18n.t 在 module-load 时会锁死语言, 不可取).
 */
const RETROSPECT_QUESTION_SHAPE: Array<{
  no: 1 | 2 | 3 | 4;
  dim: RetrospectDimT;
  optionIds: string[];
}> = [
  {
    no: 1,
    dim: "perception",
    optionIds: ["pre_narrative", "early", "mid", "late"],
  },
  {
    no: 2,
    dim: "inference",
    optionIds: ["first_one_lens", "second_one_lens", "third_multi_lens", "wavered"],
  },
  {
    no: 3,
    dim: "evaluation",
    optionIds: ["specific_anchored", "price_only", "vague", "wrong_kind"],
  },
  {
    no: 4,
    dim: "execution",
    optionIds: ["same_day", "within_week", "weeks_later", "never"],
  },
];

/** 按当前语言解析四问 (文案来自 retrospect.questions.qN.*). 每次取一份新数组, 语言切换即生效. */
export function getRetrospectQuestions(): RetrospectQuestion[] {
  return RETROSPECT_QUESTION_SHAPE.map((q) => ({
    no: q.no,
    dim: q.dim,
    title: i18n.t(`retrospect.questions.q${q.no}.title`),
    options: q.optionIds.map((id) => ({
      id,
      // optionIds 是固定枚举; 动态 key 转型成合法 key 让严格类型放行 (check-i18n 校验键存在)
      label: i18n.t(`retrospect.questions.q${q.no}.options.${id}` as "retrospect.questions.q1.options.pre_narrative"),
    })),
    openPrompt: i18n.t(`retrospect.questions.q${q.no}.openPrompt`),
  }));
}
