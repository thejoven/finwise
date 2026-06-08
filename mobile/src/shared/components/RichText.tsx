/**
 * RichText — 把带有限 HTML / Markdown 内联标记的字符串转成 RN <Text> 嵌套树.
 *
 * 为什么需要: LLM 出题 (socratic) 经常混用 `<br>` 和 `**bold**`, 直接把字符串
 * 丢给 <Display> 会让标签原样显示给用户. 这个组件做最小可靠的解析.
 *
 * 支持的语法 (按优先级):
 *   - <br> / <br/> / <br />   → 换行 (\n)
 *   - <b>...</b> <strong>...</strong>  → bold
 *   - <em>...</em> <i>...</i>          → italic
 *   - <u>...</u>                       → underline
 *   - **text**                         → bold (markdown)
 *   - *text*                           → italic (markdown, 跟单星号边界规则保持谨慎)
 *
 * 不支持 (LLM 偶尔输出但 mobile 不渲染):
 *   - <a href>  我们没浏览器侧效果, 直接当 plain text
 *   - 块级标签 <p> <div> <h1>  把 <p> 当 inline 处理, 不另起段
 *   - 嵌套属性 <b class="x">  attribute 一律忽略, 只识别 tag name
 *
 * 用法:
 *   <Display size={20}>
 *     <RichText text={question.text} />
 *   </Display>
 *
 * RichText 返回 ReactNode (Text + string 混合), 必须放在 RN <Text> 内.
 */

import { Fragment } from "react";
import { Text, type TextStyle } from "react-native";

interface Props {
  text: string;
}

type Mark = "bold" | "italic" | "underline";

interface Token {
  text: string;
  marks: Mark[];
}

export function RichText({ text }: Props) {
  const tokens = tokenize(text);
  return (
    <>
      {tokens.map((tok, i) => {
        // 换行 token: 包一层 <Text> 渲染 "\n" (父级仍是 Text, 会内联换行)
        if (tok.text === "\n") {
          // 定位型 token: 每次按源串重新 tokenize, 可能重复 (如两个 "\n") 且无稳定 id,
          // 列表不会重排/原地过滤, index 作 key 安全.
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          return <Text key={i}>{"\n"}</Text>;
        }
        if (tok.marks.length === 0) {
          // 直接 string, RN <Text> 会把它合到父 Text 里
          return <Fragment key={i}>{tok.text}</Fragment>;
        }
        const style: TextStyle = {};
        if (tok.marks.includes("bold")) style.fontWeight = "700";
        if (tok.marks.includes("italic")) style.fontStyle = "italic";
        if (tok.marks.includes("underline")) style.textDecorationLine = "underline";
        // 定位型 token: 每次按源串重新 tokenize, 可能重复 (如两段相同 bold) 且无稳定 id,
        // 列表不会重排/原地过滤, index 作 key 安全.
        return (
          // react-doctor-disable-next-line react-doctor/no-array-index-as-key
          <Text key={i} style={style}>
            {tok.text}
          </Text>
        );
      })}
    </>
  );
}

// ─────────────────────── tokenizer ───────────────────────

/**
 * 单 pass tokenizer:
 *   1. 先把 <br>* → \n 换行符 (后续 RN Text 会按 \n 拆行)
 *   2. 扫描字符流, 命中 inline 标签起止 / markdown 边界 → push/pop 当前 marks 栈
 *   3. 累计 plain 字符到 buffer, 边界时刷成 Token
 */
function tokenize(input: string): Token[] {
  const normalized = input.replace(/<br\s*\/?>/gi, "\n");
  const tokens: Token[] = [];
  const marks: Mark[] = [];
  let buf = "";

  const flush = () => {
    if (buf.length === 0) return;
    tokens.push({ text: buf, marks: [...marks] });
    buf = "";
  };

  // 把单换行作为独立 token, 让 React 渲染时不被相邻 mark style 影响
  const flushNewlines = () => {
    // buf 是每轮被 slice 重新赋值的字符串 (非数组), 这里是逐字符消费换行而非
    // 重复扫描同一集合 — 无法用 Set 替代, 否则破坏"找首个 \n → 切分 → 继续"的语义.
    // react-doctor-disable-next-line react-doctor/js-set-map-lookups
    while (buf.includes("\n")) {
      // react-doctor-disable-next-line react-doctor/js-set-map-lookups
      const idx = buf.indexOf("\n");
      const before = buf.slice(0, idx);
      if (before.length > 0) tokens.push({ text: before, marks: [...marks] });
      tokens.push({ text: "\n", marks: [] });
      buf = buf.slice(idx + 1);
    }
  };

  const text = normalized;
  let i = 0;
  while (i < text.length) {
    // ── HTML tag (lower-cased 比较) ──
    if (text[i] === "<") {
      const m = text.slice(i).match(/^<\/?(b|strong|em|i|u)\b[^>]*>/i);
      if (m) {
        flushNewlines();
        flush();
        // regex 第 1 组必定匹配, ! 通过 noUncheckedIndexedAccess
        const tag = m[1]!.toLowerCase();
        const isClose = m[0].startsWith("</");
        const mark: Mark =
          tag === "b" || tag === "strong" ? "bold" : tag === "u" ? "underline" : "italic";
        if (isClose) {
          // 最近一个相同 mark 出栈
          const idx = marks.lastIndexOf(mark);
          if (idx >= 0) marks.splice(idx, 1);
        } else {
          marks.push(mark);
        }
        i += m[0].length;
        continue;
      }
    }

    // ── markdown bold `**text**` ──
    if (text[i] === "*" && text[i + 1] === "*") {
      flushNewlines();
      flush();
      const idx = marks.lastIndexOf("bold");
      if (idx >= 0) marks.splice(idx, 1);
      else marks.push("bold");
      i += 2;
      continue;
    }

    // ── markdown italic `*text*` ──
    //    保守: 只在前一个 char 不是字母/数字时算开始 italic (避免吞掉 a*b 这种)
    if (text[i] === "*") {
      const prev = text[i - 1] ?? "";
      const next = text[i + 1] ?? "";
      // marks 是随 push/splice 不断变化的小栈 (≤3 项), 此处每个 `*` 边界只查一次;
      // 把它 hoist 成 Set 会失效 (内容随循环变), 这不是对稳定集合的重复扫描.
      // react-doctor-disable-next-line react-doctor/js-set-map-lookups
      const isBoundary = !/[a-zA-Z0-9]/.test(prev) || marks.includes("italic");
      if (isBoundary && next !== "*") {
        flushNewlines();
        flush();
        const idx = marks.lastIndexOf("italic");
        if (idx >= 0) marks.splice(idx, 1);
        else marks.push("italic");
        i++;
        continue;
      }
    }

    buf += text[i];
    i++;
  }
  flushNewlines();
  flush();
  return tokens;
}
