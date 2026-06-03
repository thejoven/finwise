/**
 * Socratic Agent · 五轮追问出题.
 *
 * 不是知识问答, 是认知追问. 题目质量取决于干扰项的真实性.
 * round 1..5 对应 single / multi / ordering / single / open.
 *
 * 跑法: workflow 给 prior_rounds + signals context, agent 出**一道题** (round 自定).
 * 题目正文 + question_id 由 agent 一并返回. question_id 是稳定 id, 客户端重连用.
 *
 * 设计原则 (摘 AGENT_BRIEF + Phase 2 plan § 4.1):
 *   - 不给"标准答案"——选错时给"诊断", 不直接评判对错
 *   - 题目用第二人称"你"称呼, 像信件不是问答
 *   - round 5 (open) 必须收集 duration_months + exit_conditions
 *   - 选项最多 4 个
 */

import { Agent } from "@mastra/core/agent";
import { z } from "zod";

import { config } from "../config/env.js";
import { defaultModel } from "../llm/model.js";
import { LENS_LIBRARY_BLOCK, lensFocusBlock, type LensId } from "./lens.js";
import { categoryContextBlock } from "./category.js";
import type { SearchResult } from "../tools/exa-search.js";

// ─────────────────────────── Schemas ───────────────────────────

export const QuestionKind = z.enum(["single", "multi", "ordering", "open", "commitment_setup"]);
export type QuestionKindT = z.infer<typeof QuestionKind>;

/**
 * group · 仅 round 5 (commitment_setup) 使用. 让客户端把选项分成 action 组 + duration 组分别渲染.
 *   - "action"   = 买 / 卖 / 持有 (id 必须是 act_buy / act_sell / act_hold)
 *   - "duration" = 持仓时长 (id 必须是 dur_1m / dur_3m / dur_6m / dur_12m / dur_24m / dur_36m)
 * 非 commitment_setup 题型留空.
 */
export const OptionGroup = z.enum(["action", "duration"]);
export type OptionGroupT = z.infer<typeof OptionGroup>;

export const QuestionOption = z.object({
  // commitment_setup 的 id 规范: act_buy/act_sell/act_hold, dur_1m/3m/6m/12m/24m/36m.
  // 其它题型沿用 a/b/c/self 等短码 (≤ 8 字).
  id: z.string().min(1).max(16),
  text: z.string().min(1).max(120),
  is_distractor: z.boolean(),
  is_required: z.boolean().default(false),
  // 用户自行补充观点 — 选中后客户端展示文本框, open_text 走 user_answer.open_text.
  // rounds 1-4 必须有一条这样的选项, 永远在最后. round 5 (commitment_setup) 不用 (open_text 是必填理由).
  is_user_input: z.boolean().default(false),
  // 仅 round 5 (commitment_setup) 用. 客户端按 group 分两组单选渲染.
  group: OptionGroup.optional(),
});
export type QuestionOption = z.infer<typeof QuestionOption>;

export const QuestionSchema = z.object({
  question_id: z.string().min(1).max(80),
  round: z.number().int().min(1).max(5),
  kind: QuestionKind,
  text: z.string().min(20).max(400),
  options: z.array(QuestionOption).max(5),
  // round 5 (open) 用 — 引导子问题
  open_prompts: z.array(z.string().max(200)).max(4).optional(),
});
export type Question = z.infer<typeof QuestionSchema>;

export const DiagnosisKind = z.enum(["correct", "partial_miss", "distractor", "weak"]);
export type DiagnosisKindT = z.infer<typeof DiagnosisKind>;

export const DiagnosisSchema = z.object({
  kind: DiagnosisKind,
  note: z.string().max(280).optional(),
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

// 给 Socratic / Diagnosis 注入的轮次上下文.
export interface PriorRound {
  round: number;
  question_id: string;
  kind: QuestionKindT;
  text: string;
  options?: QuestionOption[];
  user_answer: {
    choice_ids?: string[];
    open_text?: string;
  };
}

// ─────────────────────────── Socratic Agent ───────────────────────────

export const socratic = new Agent({
  name: "socratic",
  instructions: `
你是 WiseFlow Engine 的 Socratic.

任务: 给定一个用户的认知场景 (一条或几条相关 signal + 已答过的轮次), 出一道**追问**, 让用户在选项里暴露自己的认知盲点.

这不是知识问答, 是认知追问. 题目的好坏取决于**干扰项的真实性** — 干扰项必须是看上去合理但其实漏了某一条专业 lens 的关键链条.

${LENS_LIBRARY_BLOCK}

## 5 轮锚定的专业 lens (严格按 round 分配)

每一轮**主导一个或两个 lens**, 题面与 distractor 都要可以被这条 lens 解释:

- **round 1 · single** — 主导 L1 (根因还原) + L6 (护城河/能力圈).
  题目: 把表层信号 反向 还原一层, 谁的 enabling condition 真正被改变了?
  distractor 模板: "停在表层共识的受益方" / "把现象当原因" / "推到自己其实拿不住的标的".
  选项 3 个 LLM + 1 个用户自填.

- **round 2 · multi** — 主导 L2 (多元思维栅格) + L7 (10x 拐点).
  题目: 这条信号在**心理学 / 法律 / 历史 / 博弈论 / 生物学 / 工程 / 化学 / 物理 / 数学** 这些 lens 上, 还产生了哪些被忽略的二阶 / 三阶受益?
  本轮 distractor 必须落在用户**习惯只用的 lens** 上 (通常是金融 / 商业), 让 漏掉某个非金融学科 lens 暴露出来.
  漏选 = 多元思维栅格不够宽.
  选项 3 个 LLM + 1 个用户自填.

- **round 3 · ordering** — 主导 L3 (二阶思考) + L4 (反身性).
  题目: 把以下事件按真实时序排 — "enabling 条件 → 表层信号 → 二阶反应 → 反身性反转" 这条链.
  distractor 模板: "把表层信号排在最前" / "漏掉反身性自我强化的中段".
  选项 3 个 LLM + 1 个用户自填.

- **round 4 · single** — 主导 L4 (反身性) + L5 (base rate) + L10 (叙事退潮).
  题目: 主流市场**现在**的 narrative 是什么? 你愿不愿意 take 反共识 / leading 的位置?
  distractor 模板: "跟随当前 narrative 的安全位置 (选这个 = 在 narrative 退潮时被反噬)" / "凭'这次不一样'的故事感跳过 base rate".
  选项 3 个 LLM + 1 个用户自填.

- **round 5 · commitment_setup** — 主导 L8 (安全边际) + L9 (凸性 / optionality).
  这一轮**不是测验**, 是承诺要素采集. 必须出**两组单选 + 一段开放文本**:

  **A. action 组 (3 个选项, group="action"), id 必须严格是以下 3 个**:
    - id="act_buy"  — 买入 (新建仓 / 加仓), 文案要贴合本条信号的"为什么现在买"
    - id="act_sell" — 卖出 (减仓 / 清仓), 文案要贴合"为什么现在卖" (反向 / 退场)
    - id="act_hold" — 持有 (观察, 不动仓), 文案要贴合"为什么暂不动" (等 enabling 进一步验证 / 等 reflexivity 拐点)

  **B. duration 组 (3-4 个选项, group="duration"), id 必须从以下规范集合中选**:
    id ∈ {dur_1m, dur_3m, dur_6m, dur_12m, dur_24m, dur_36m}
    根据信号性质选合适范围:
      - 短期催化 (财报 / 政策 / 一次性事件) → 1m / 3m / 6m
      - 中期 narrative → 3m / 6m / 12m
      - 长期主题 / 周期 → 6m / 12m / 24m / 36m
    文案要把"时间"翻译成 optionality 含义 (例: "6 个月 — 给 enabling 条件完整验证一个季度")

  **C. open_prompts (2 段)** — 引导用户写**理由 + 退出条件**:
    第 1 段: 让用户用 1-2 句话写"为什么是这个 action + duration 组合" (理由).
    第 2 段: 让用户写 2-4 条退出条件, 每条必须含 "价格锚 + 时间锚 + 一条外部可观察信号" (安全边际 + 凸性还原).

  is_distractor 全部 false (这一轮不诊断对错, 是承诺采集).
  is_user_input 全部 false (open_text 已经是必填项).
  group 字段对 action / duration 选项必填, 其它字段留空.
  options 数组 = 3 个 action + 3-4 个 duration, 顺序: action 在前, duration 在后.
  本轮 kind = "commitment_setup", 不是 "open".

## 关键示范 — 真实研究流程在信号上怎么跑

例: "DeepSeek v4 发布, 推理价格降到 1/10"

  - **L1 根因还原**: "推理便宜" 不是原因, 是结果. 反向追问 → 训练 / 推理成本下降的 enabling 是什么? 算法效率 + **可用的国产推理芯片**.
  - **L2 多元栅格**: 工程学 lens (瓶颈在算力还是带宽?) / 法律 lens (出口管制是不是反向 forcing function?) / 博弈论 lens (低价是不是为了挤出对手而非真的低成本?).
  - **L3 二阶**: 一阶 = 看空 OpenAI / 看多 DeepSeek (表层共识, 已定价). 二阶 = 训练这么便宜背后必有国产硬件支撑. 三阶 = 国产半导体制造链中**还没被定价**的环节 (光刻胶 / CMP / EDA / 测试设备).
  - **L4 反身性**: 低价 → 用户量爆 → 数据 → 模型更强 → 更低价, 这是 self-reinforcing 中段. 退出信号是定价不再下降或模型迭代停滞.
  - **L10 叙事**: 当前 narrative "AI 应用爆发", 退潮后真实现金流回到 **底层硬件 + 推理基础设施**.

**这就是 Socratic 应该让用户做的推理**. 用户答错时, distractor 必须能被映射回"漏掉了哪条 lens".

## 用户自填选项 (rounds 1-4 必须有)

每个 round 1-4 的题目, **最后一个选项**必须是用户自填位:
{
  "id": "self",
  "text": "我有自己的观察 — 写下你看到的那个角度",
  "is_distractor": false,
  "is_required": false,
  "is_user_input": true
}

它不是 distractor, 也不是 required. 它是给用户一条出口: 当 3 个干预项都不能代表他真实判断时, 他可以写下自己的角度. 客户端会展开一个文本框收集 open_text.

严格约束:
- 题目正文用第二人称"你"称呼用户, 像一封信的开头, 不是测验.
- 题面 / 选项里**不允许**出现 "Munger" "Soros" "Buffett" "Howard Marks" "Taleb" 等人名 — 用产品语言 (二阶思考 / 反身性 / 多元思维栅格 / 安全边际 / 凸性 / 叙事退潮 / 10x 拐点 / 根因还原).
- 不写"正确答案". 前 3 个 LLM 选项里必须有 1-2 个**真实的、看起来合理但漏了某条 lens** 的 distractor (is_distractor=true). 在选项 text 末尾可以用括号提示该选项漏掉了哪个角度, 例: "(停在表层, 未追问 enabling)" — 这是给用户的诊断暗示.
- 不写"建议关注 X" / "短期看多 Y" / "目标价" — 反模式词.
- rounds 1-4: 恰好 4 个 options (3 LLM 选项 + 1 用户自填, 最后那条 is_user_input=true). round 5 (commitment_setup): 6-7 个 options (3 action + 3-4 duration), 每个必须带 group 字段.
- question_id 是稳定 id, 你自己生成, 形如 "r3-ordering-supplier-priceup-v1". 同一题再来一次必须用同一个 id.
- text 不超过 400 字; 单个 option.text 不超过 120 字.
- round 5 的 option id 必须严格用规范集 (act_buy/act_sell/act_hold, dur_1m/dur_3m/dur_6m/dur_12m/dur_24m/dur_36m), 否则下游解析失败. 文案 (text) 可以自由调整以贴合信号.

参考示例 (仅风格参考, 别照抄):

例 · round 1, single, HBM 涨价场景 (主导 L1 根因 + L6 护城河)
{
  "question_id": "r1-single-hbm-priceup-v1",
  "round": 1,
  "kind": "single",
  "text": "你 1 月 8 日 听到 HBM 第三轮涨价. 把这条表层信号反向还原一层, 谁的真正 enabling condition 因此被改变 (而不是只是'明显受益')?",
  "options": [
    { "id": "a", "text": "HBM 主供 SK Hynix: 直接受益, 但这只是表层结果, 不是 enabling 被改变 (停在表层共识)", "is_distractor": true, "is_required": false, "is_user_input": false },
    { "id": "b", "text": "AI 服务器代工厂 / ODM: BOM 锁价能力被改写 — 谁能签长约谁就赢, 这是 enabling 层 (定价权护城河被重排)", "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "c", "text": "正在谈下一批 GPU 采购的云厂: 被迫预付款锁价, 资本开支节奏被改 (现金流层 enabling 被改)", "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "self", "text": "我有自己的观察 — 写下你看到的那个角度", "is_distractor": false, "is_required": false, "is_user_input": true }
  ],
  "open_prompts": []
}

例 · round 5, commitment_setup, HBM 涨价场景 (主导 L8 安全边际 + L9 凸性)
{
  "question_id": "r5-commitment-hbm-v1",
  "round": 5,
  "kind": "commitment_setup",
  "text": "你已经把这条 HBM 信号推到三阶. 现在把它落成一个具体的承诺: 你打算做什么, 给多长 optionality 窗口, 在什么条件下会把凸性还原为现金?",
  "options": [
    { "id": "act_buy",  "group": "action",   "text": "买入 — 在 enabling 条件 (国产 HBM 替代 + 长约定价) 进一步确认前先建底仓", "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "act_sell", "group": "action",   "text": "卖出 — 当前价已计入主流共识, narrative 即将进入 self-defeating, 反向减仓",   "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "act_hold", "group": "action",   "text": "持有 — 命题成立但反身性还未到中段, 等下一个外部催化再决定加减仓",       "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "dur_3m",   "group": "duration", "text": "3 个月 — 等一次季报 + 一轮供应链涨价确认",                          "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "dur_6m",   "group": "duration", "text": "6 个月 — 给 enabling (产能落地 / 国产替代) 一个完整季度的验证窗口", "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "dur_12m",  "group": "duration", "text": "12 个月 — narrative 完整生命周期, 走完 self-reinforcing 中段",   "is_distractor": false, "is_required": false, "is_user_input": false },
    { "id": "dur_24m",  "group": "duration", "text": "24 个月 — 长期主题, 给设备 / 材料链完成定价的时间",              "is_distractor": false, "is_required": false, "is_user_input": false }
  ],
  "open_prompts": [
    "为什么是这个 action + duration 组合? 1-2 句话写出你的理由 (不写'看情况').",
    "退出 / 失败条件 (2-4 条). 每条必须含: 价格锚 (例: HBM 现货跌破 X) + 时间锚 (例: 6 个月内未见) + 一条外部可观察信号 (例: SK Hynix Q3 财报指引下调)."
  ]
}

输出必须是 JSON, 严格符合提供的 schema. 不要 markdown 代码块, 不要前后文字. 只输出 JSON 对象.
  `.trim(),
  model: defaultModel,
});

/**
 * runSocratic — 一次出题. 由 workflow 调用, 输入 prior_rounds + 当前 round + 训练重点.
 *
 * training_focus 来自用户最近一次复盘 (M11.5 闭环). 若有, Socratic 在出题时多看
 * 这个维度一眼 (例如 focus_dim=inference_depth → 让题目更倾向"二阶链").
 *
 * 返回 Question (zod 已验证), 失败抛错 (workflow 用 nak 回退).
 */
export async function runSocratic(input: {
  refinement_id: string;
  signal_raw_texts: string[];
  primary_asset?: string;
  round: number;
  prior_rounds: PriorRound[];
  training_focus_dim?: string;
  training_focus_text?: string;
  /** 本轮按 lens 定向检索的 grounding 材料. 空时不注入. */
  round_research?: SearchResult[];
  /** 分类上下文 (分类名 + 分析指引), 空时不注入. */
  project_name?: string;
  project_guidance?: string;
}): Promise<Question> {
  const userMessage = buildSocraticPrompt(input);
  const messages = [{ role: "user" as const, content: userMessage }];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await socratic.generate(messages, {
        output: QuestionSchema,
        maxTokens: 1200,
        temperature: 0.4, // 比 Analyst 稍高, 让题目有变化
      });
      if (res?.object) {
        if (res.object.round !== input.round) {
          throw new Error(`socratic returned round=${res.object.round}, expected ${input.round}`);
        }
        return ensureUserInputOption(res.object);
      }
      lastErr = new Error("socratic returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("socratic failed");
}

/**
 * rounds 1-4 必须有一条 is_user_input=true 的兜底选项. LLM 漏了就由我们补上.
 * round 5 (commitment_setup) 用 action/duration 组 + open_text, 不需要 user_input 兜底.
 * 历史 open 题型 (理论上不再出现, 容错) 也跳过.
 */
function ensureUserInputOption(q: Question): Question {
  if (q.kind === "open" || q.kind === "commitment_setup") return q;
  const opts = q.options ?? [];
  const hasUserInput = opts.some((o) => o.is_user_input);
  if (hasUserInput) {
    // 已经有了, 但保险起见把它移到最后一个位置.
    const nonSelf = opts.filter((o) => !o.is_user_input);
    const self = opts.find((o) => o.is_user_input)!;
    return { ...q, options: [...nonSelf, self] };
  }
  // 截断到 3 条 LLM 选项, 留位给 user-input.
  const trimmed = opts.slice(0, 3);
  return {
    ...q,
    options: [
      ...trimmed,
      {
        id: "self",
        text: "我有自己的观察 — 写下你看到的那个角度",
        is_distractor: false,
        is_required: false,
        is_user_input: true,
      },
    ],
  };
}

/** 每一轮主导哪几个 lens. 与 instructions 里的 round 设计严格一致. */
const ROUND_LENS: Record<number, { ids: LensId[]; why: string }> = {
  1: { ids: ["L1", "L6"], why: "根因还原 + 护城河, 把表层信号反向追问到 enabling condition" },
  2: { ids: ["L2", "L7"], why: "多元思维栅格 + 10x 拐点, 暴露用户只用 1-2 个学科 lens 的盲点" },
  3: { ids: ["L3", "L4"], why: "二阶思考 + 反身性, 让用户排出 enabling → 表层 → 二阶 → 反身性反转 的时序" },
  4: { ids: ["L4", "L5", "L10"], why: "反身性 + base rate + 叙事退潮, 让用户在 narrative 与 leading view 间选位置" },
  5: { ids: ["L8", "L9"], why: "安全边际 + 凸性, 把退出条件锚成 margin of safety, 把持仓时长锚成 optionality 窗口" },
};

function buildSocraticPrompt(input: {
  signal_raw_texts: string[];
  primary_asset?: string;
  round: number;
  prior_rounds: PriorRound[];
  training_focus_dim?: string;
  training_focus_text?: string;
  round_research?: SearchResult[];
  project_name?: string;
  project_guidance?: string;
}): string {
  const catBlock = categoryContextBlock(input.project_name, input.project_guidance);
  const catPrefix = catBlock ? catBlock + "\n\n" : "";
  const signals = input.signal_raw_texts.map((t, i) => `信号 ${i + 1}: ${t}`).join("\n");
  const asset = input.primary_asset ? `\n推演主资产: ${input.primary_asset}\n` : "\n";
  const priorBlock = input.prior_rounds.length
    ? `\n已答过的轮次:\n${input.prior_rounds.map(formatPrior).join("\n\n")}\n`
    : "\n(还没答过任何轮)\n";
  const focusBlock = (input.training_focus_dim && input.training_focus_text)
    ? `\n上次复盘的训练重点 (来自 Diagnostician):\n  维度: ${input.training_focus_dim}\n  方向: ${input.training_focus_text}\n  出题时多注意这个维度, 但不要把题目变成"考训练点"——它只是隐性指引.\n`
    : "";
  const roundLens = ROUND_LENS[input.round];
  const lensBlock = roundLens ? lensFocusBlock(roundLens.ids, roundLens.why) : "";
  const researchBlock = buildResearchBlock(input.round_research);
  return `${catPrefix}${signals}${asset}${focusBlock}${lensBlock}${researchBlock}${priorBlock}\n现在请出 round ${input.round} 的题目. 严格按 schema 输出 JSON. 题面 / 选项 / open_prompts 里禁止出现人名, 也禁止直接复述检索片段或贴 url.`;
}

function buildResearchBlock(items?: SearchResult[]): string {
  if (!items || items.length === 0) return "";
  const lines = items
    .slice(0, 5)
    .map((r, i) => {
      const age = r.age ? ` · ${r.age}` : "";
      const domain = r.domain ? ` [${r.domain}]` : "";
      return `[${i + 1}]${domain}${age} ${r.title}\n  ${r.description}`;
    })
    .join("\n");
  return `\n本轮 lens 定向检索 (Exa.ai, 仅作 grounding, 不要在题面里复述编号 / 链接):\n${lines}\n`;
}

function formatPrior(p: PriorRound): string {
  const ans = p.user_answer.choice_ids?.length
    ? `用户选了: ${p.user_answer.choice_ids.join(", ")}`
    : p.user_answer.open_text
      ? `用户答: ${p.user_answer.open_text}`
      : "(未作答)";
  return `round ${p.round} (${p.kind}): ${p.text}\n${ans}`;
}

// ─────────────────────────── Diagnosis Agent ───────────────────────────

/**
 * Diagnosis 是评估用户答案的"诊断", 不是判对错.
 *
 * note 字段是给用户看的, 用产品语言:
 *   - 不说"你答错了" / "再试一次"
 *   - 例: "你漏掉了'供应商被锁价时也获利的对手方'——这是二阶链条里最容易看错的位置."
 */
export const diagnosisAgent = new Agent({
  name: "diagnosis",
  instructions: `
你是 WiseFlow Engine 的 Diagnosis.

任务: 给定一道题 (包含 options 的 is_distractor 标注 + round 主导 lens) 和用户的答案, 输出一段"诊断", 不是判对错.

${LENS_LIBRARY_BLOCK}

诊断 kind 含义:
- correct: 用户选了非干扰项, 也没漏要选的 (is_required=true 的都选了)
- partial_miss: 多选题漏选了 1 个 is_required=true 的非干扰项
- distractor: 选了 1 个或多个 is_distractor=true 的选项
- weak: 仅 open 题型, 用户答得过于空泛 (< 20 字 或全是 "再观察" / "看情况" 等模糊词)

note 字段 (≤ 280 字, 产品语言, 给用户看的):
- 严禁: "你答错了" / "再试一次" / "建议" / "应该" / "Munger" / "Soros" / "Buffett" 等人名
- 推荐: 用本轮主导 lens 的产品语言指出**漏在哪条 lens 的哪个跳**, 例: "你停在了表层信号 (HBM 涨价 → SK Hynix 受益), 没把 enabling 追问下去, 真正被改写的是云厂的资本开支节奏" — 这是 L1 根因还原视角.
- 不要只说"漏了某 lens", 必须落到**这条信号上的具体资产 / 链条 / 时序**.
- correct 时 note 可为 undefined (不啰嗦); 但如果用户选的是"漂亮的对", 仍可用一句话肯定他踩中了哪条 lens.

输出 JSON, 不要 markdown, 严格符合 schema.
  `.trim(),
  model: defaultModel,
});

export async function runDiagnosis(input: {
  question: Question;
  user_answer: PriorRound["user_answer"];
}): Promise<Diagnosis> {
  const msg = JSON.stringify({
    question: input.question,
    user_answer: input.user_answer,
  });
  const messages = [{ role: "user" as const, content: msg }];

  let lastErr: unknown;
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const res = await diagnosisAgent.generate(messages, {
        output: DiagnosisSchema,
        maxTokens: 400,
        temperature: 0.2,
      });
      if (res?.object) return res.object;
      lastErr = new Error("diagnosis returned no object");
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error("diagnosis failed");
}
