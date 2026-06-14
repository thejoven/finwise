/**
 * 输出语言指令 —— 让面向用户的 AI 产出跟随 App 选定的语言.
 *
 * 覆盖: 投决会判词(consensus/thickness/timing/competence) · 归档对话(analyst-chat) ·
 *       降噪/受益链(distiller/beneficiary) · 五轮追问(socratic/diagnosis) ·
 *       M9 陪伴(editor) · M11 复盘(diagnostician) · 订阅打标(tweet-classifier).
 *
 * 机制: 各 agent 的 instructions 仍是中文(连同 lens / 宏观基底不动). 这里只产出一段
 *       "输出语言"指令, 由调用方拼到 user message **最前面**. 模型据此把产出写成目标语言,
 *       思考/评分逻辑不受影响.
 *
 * 关键: 简体是源语言/默认 —— 返回空串, 行为与历史**完全一致**, 对存量零风险.
 *       只有 en / zh-Hant 才注入指令.
 *
 * 注意 schema 长度: 各 schema 的 .max() 是按**中文字数**调的(如 narrative_summary ≤80).
 *       英文等义文本字符数约 2.5x, 故 en 路径下相关 .max() 已相应放宽(见各 schema),
 *       prompt 里的 "≤N 字" 仍用来约束中文简洁度.
 */

/** 与 mobile `SupportedLanguage` 对齐: "zh-Hans" | "zh-Hant" | "en". 其它/空 → 当默认(简体). */
export function languageDirective(language?: string | null): string {
  switch (language) {
    case "en":
      return (
        [
          "## OUTPUT LANGUAGE — STRICT",
          "Write ALL user-facing output in natural, idiomatic English (en-US).",
          "The instructions above are in Chinese — they describe HOW to think, score, and structure output. Your OUTPUT to the user MUST be in English regardless.",
          "Use standard English finance vocabulary (reflexivity, base rate, optionality, crowded trade, margin of safety, capital cycle, etc.). Do NOT emit Chinese characters in user-facing fields.",
          "Length limits in the instructions are stated in Chinese characters (字) — treat them as rough guidance; keep English concise and equivalent in substance, not padded.",
        ].join("\n") + "\n\n"
      );
    case "zh-Hant":
      return (
        [
          "## 輸出語言 — 嚴格",
          "所有面向使用者的輸出一律使用繁體中文（臺灣用語習慣）。",
          "上面的指令以簡體中文撰寫，描述的是思考與評分方式；但你給使用者的**輸出**必須是繁體中文。",
          "沿用慣用英文術語（reflexivity / base rate / optionality 等），首次出現可加繁體釋義。",
        ].join("\n") + "\n\n"
      );
    default:
      // "zh-Hans" / undefined / null / 未知: 源语言, 不注入指令, 行为完全不变.
      return "";
  }
}
