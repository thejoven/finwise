/**
 * AlphaX Pro Lens · 真实研究流程框架.
 *
 * 把分散在 socratic / consensus / diagnostician 三个 agent 里
 * 那些"凭直觉"的角度词, 统一锚定到被验证过的研究框架上:
 *
 *   L1 Bridgewater 根因          Dalio 5-step, 把表层信号还原到 enabling condition
 *   L2 Munger Lattice            多学科 mental models 栅格, 跨域捕获盲点
 *   L3 Howard Marks 二阶思考      first-level vs second-level, 链条至少跑到第 3 跳
 *   L4 Soros 反身性              价格 ↔ 基本面 反馈环, self-reinforcing → self-defeating
 *   L5 Mauboussin 外部视角        outside view / base rates 替代 inside view 过度自信
 *   L6 Buffett 护城河 + 能力圈    moat 在 build 还是 erode, 受益方是否在 circle of competence
 *   L7 Grove 10X 力量            Porter 五力被 10x 加速, incumbent vs challenger 重排
 *   L8 Graham 安全边际            replacement cost / liquidation value, 退出条件的下限
 *   L9 Taleb 反脆弱 / 凸性        不对称收益曲线, optionality 时间窗
 *   L10 Shiller 叙事经济学        narrative 是定价发动机, 退潮后现金流去向
 *
 * 用法:
 *   - prompt 里直接拼 LENS_LIBRARY_BLOCK 作为公共上下文
 *   - 某个 agent / round 强调某个 lens 时, 用 lensFocus("L3", "二阶时序") 拼成 hint
 *   - distractor 设计时, 让"漏掉某 lens"成为可解释的失误
 *
 * 重要约束: 不要把这套框架变成名词背诵. 它是 prompt 内部的"专业基底",
 * 给用户看到的题面 / 选项 / 诊断里**不要**直接出现 "Munger", "Soros" 这种人名 —
 * 用产品语言转译 ("多元思维栅格", "反身性", "二阶链").
 */

export type LensId =
  | "L1"
  | "L2"
  | "L3"
  | "L4"
  | "L5"
  | "L6"
  | "L7"
  | "L8"
  | "L9"
  | "L10";

export interface Lens {
  id: LensId;
  /** 内部代号, prompt 里用 */
  code: string;
  /** 产品语言别名, 用户层文案用这个 */
  alias: string;
  /** 一句话定位 */
  thesis: string;
  /** 用户在这一 lens 上最常踩的坑 */
  blind_spot: string;
}

export const LENSES: Record<LensId, Lens> = {
  L1: {
    id: "L1",
    code: "Bridgewater 根因",
    alias: "根因还原",
    thesis: "表层信号 → 反复追问 enabling condition, 直到落到不能再拆的物理 / 制度变量.",
    blind_spot: "停在表层 (例: 看到 HBM 涨价就说 SK Hynix 受益), 不追问 '为什么这次能涨价'.",
  },
  L2: {
    id: "L2",
    code: "Munger Lattice",
    alias: "多元思维栅格",
    thesis: "心理学 / 法律 / 历史 / 博弈论 / 生物学 / 工程 / 化学 / 物理 / 数学 这 9 个 mental model 交叉看一遍.",
    blind_spot: "只用 1-2 个熟悉的 lens (金融 + 商业), 其它学科上的受益方被忽略.",
  },
  L3: {
    id: "L3",
    code: "Howard Marks 二阶",
    alias: "二阶思考",
    thesis: "first-level: '事好 → 涨'; second-level: '事好但已知 → 谁会反应 → 反应后谁受益', 链条跑到第 3 跳以上.",
    blind_spot: "推演停在第 1 跳, 把'明显受益方'误当成 alpha, 实际上它已经被定价.",
  },
  L4: {
    id: "L4",
    code: "Soros 反身性",
    alias: "反身性反馈环",
    thesis: "价格 → 改变基本面 → 又强化价格. self-reinforcing 中段是 alpha, self-defeating 拐点是退出.",
    blind_spot: "把反身性的 self-reinforcing 阶段当作'基本面真的变好', 没准备好拐点信号.",
  },
  L5: {
    id: "L5",
    code: "Mauboussin 外部视角",
    alias: "base rate 外部视角",
    thesis: "用 reference class 的统计 base rate 校准 inside view 直觉, 避免对个案的过度自信.",
    blind_spot: "凭'这次不一样'的故事感跳过 base rate, 实际历史上同类事件成功率很低.",
  },
  L6: {
    id: "L6",
    code: "Buffett 护城河 + 能力圈",
    alias: "护城河 / 能力圈",
    thesis: "这件事在 build / erode 谁的 durable moat? 受益方是否在你 1m 深的认知里, 不是 1cm 宽的浏览.",
    blind_spot: "推到一个自己只听过名字的'受益方', 看上去 alpha 实际上无法持仓 (拿不住).",
  },
  L7: {
    id: "L7",
    code: "Grove 10X 力量",
    alias: "10x 拐点",
    thesis: "Porter 五力中某一力被 10 倍加速时, incumbent vs challenger 重排, 现金流被强制再分配.",
    blind_spot: "把渐进式变化当作 10x 力量, 或反过来把真正的 10x 力量当成'又一次小波动'.",
  },
  L8: {
    id: "L8",
    code: "Graham 安全边际",
    alias: "安全边际",
    thesis: "replacement cost / liquidation value / 重置成本 给出价值下限. 出错时能保住多少决定能不能持仓.",
    blind_spot: "退出条件只看价格止损, 没有 intrinsic 价值锚, 一砸就空仓.",
  },
  L9: {
    id: "L9",
    code: "Taleb 反脆弱 / 凸性",
    alias: "凸性 / optionality",
    thesis: "不对称收益: downside 有限, upside 开放. 持仓本身是个 option, 时间是行权窗口.",
    blind_spot: "把对称收益的仓位当成 optionality, 或在 optionality 还没兑现前就把 option 卖掉.",
  },
  L10: {
    id: "L10",
    code: "Shiller 叙事经济学",
    alias: "叙事退潮",
    thesis: "故事是定价的发动机, 不是装饰. 当 narrative 衰减时, 真实现金流回到哪里决定最终估值.",
    blind_spot: "把 narrative 当作基本面, narrative 退潮才发现现金流根本不在那里.",
  },
};

/**
 * 专业英文术语的中文释义约束 — 任何输出"面向用户文案"的 agent 都该 import.
 * 已被 LENS_LIBRARY_BLOCK 内嵌; analyst / narrator 等不引 lens 块的 agent 单独引这个常量.
 */
export const JARGON_TRANSLATION_BLOCK = `
## 专业英文术语的中文释义约束 (面向用户文案)

凡是面向用户的输出字段 — 题面 / 选项 text / open_prompts / 诊断 note / 承诺 thesis /
narrative_summary / evidence / 复盘文案 / inference rationale / one_line_summary — 出现
英文专业术语时, **必须紧跟中文释义括号**, 首次出现必带, 同一段文本内重复出现可省.

格式: 英文术语 (中文释义 — 一句话点出本质)
   ✗ "建一个 optionality 头寸"
   ✓ "建一个 optionality (选择权 — 不对称收益, 下行有限 / 上行开放) 头寸"
   ✗ "narrative 已到 self-defeating 拐点"
   ✓ "narrative (叙事) 已到 self-defeating (自我反噬 — 价格反过来侵蚀基本面) 拐点"

下表是规范译名 — 用户层面遇到这些英文时**只用这一套**, 不要每个 agent 自创不同译法:

  - optionality          → 选择权 / 可选性 — 下行有限上行开放的不对称收益
  - convexity            → 凸性 — 收益曲线向上弯, 极端事件里赚得更多
  - base rate            → 基础概率 — 历史同类事件的统计先验
  - reflexivity          → 反身性 — 价格改变基本面又反向强化价格的反馈环
  - self-reinforcing     → 自我强化 — 反身性的中段, 越涨越像真的
  - self-defeating       → 自我反噬 — 反身性的拐点, 价格反过来侵蚀基本面
  - moat                 → 护城河 — durable 的竞争壁垒
  - circle of competence → 能力圈 — 你真懂、能持仓的认知边界
  - enabling condition   → 触发条件 — 让表层现象成立的底层物理 / 制度变量
  - narrative            → 叙事 — 市场用来定价的故事
  - mental model         → 思维模型
  - lattice              → 思维栅格 — 多个模型交叉构成的认知网
  - margin of safety     → 安全边际 — 估值与价格的缓冲距离
  - intrinsic value      → 内在价值
  - replacement cost     → 重置成本 — 重新造一份同等产能要多少钱
  - first-level          → 一阶思考 — 表层因果
  - second-level         → 二阶思考 — 推一步以上, 谁会反应、反应后谁受益
  - inside view          → 内部视角 — 凭这个案例本身的细节判断
  - outside view         → 外部视角 — 凭同类历史 base rate 判断
  - alpha                → 超额收益 (alpha) — 跑赢市场基准的部分
  - leading / aligned / lagging → 领先 / 同步 / 滞后 (相对市场共识)
  - crowded trade        → 拥挤交易 — 持仓集中、共识已满
  - early / mid / late-stage → 早期 / 中期 / 晚期 (narrative 传播阶段)
  - sell-side            → 卖方 (券商研究)
  - tail risk            → 尾部风险
  - drawdown             → 回撤
  - hedge                → 对冲
  - 10x force            → 10 倍力量 — 让产业格局重排的非线性变化
  - BOM                  → 物料清单 (Bill of Materials)
  - opex / capex         → 运营开支 / 资本开支

不在这张表里的英文术语 (不常见或太专门), 仍然必须带中文释义括号, 用一句话定义即可.
中文已经有公认对应词的概念 (反身性 / 护城河 / 安全边际 / 凸性 / 二阶 / 能力圈 / 叙事 等)
**不必再括注英文** — 直接用中文.
`.trim();

/** 给 LLM prompt 用的纯文本块. 公共基底, 5 个 agent (socratic / consensus / diagnostician / thickness / lens) 都拼一次. */
export const LENS_LIBRARY_BLOCK = `
## AlphaX Pro Lens · 真实研究流程框架

任何一条信号必须至少**经过下面 10 个 lens 中的 3-4 个**才算被推演过. 不是名词背诵,
是出题 / 评分 / 诊断时**真实使用**的认知工具.

${Object.values(LENSES)
  .map(
    (l) =>
      `${l.id} · ${l.code} (${l.alias})
   立场: ${l.thesis}
   常见盲点: ${l.blind_spot}`,
  )
  .join("\n\n")}

**严禁**在面向用户的文案里出现 "Munger" "Soros" "Buffett" 等人名. 用产品语言 (二阶思考 /
反身性 / 护城河 / 安全边际 / 凸性 / 多元思维栅格 / 叙事退潮 / 10x 拐点) 表述.

${JARGON_TRANSLATION_BLOCK}
`.trim();

/** 在 prompt 里强调某一组 lens 时用. 例: lensFocusBlock(["L3", "L4"], "本轮重点测时序与反身性") */
export function lensFocusBlock(ids: LensId[], why: string): string {
  const items = ids
    .map((id) => `  - ${LENSES[id].id} ${LENSES[id].code} (${LENSES[id].alias}): ${LENSES[id].thesis}`)
    .join("\n");
  return `\n本轮主导 lens (${why}):\n${items}\n`;
}
