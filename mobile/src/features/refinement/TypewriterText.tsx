/**
 * Typewriter — 文字 chunk-by-chunk 显示, 不闪 spinner.
 *
 * 用法:
 *   <TypewriterText text="正在出下一题..." />
 *
 * 默认 30ms 一个字符, 出完不再循环. 重新挂载会重出.
 */

import { useEffect, useRef, useState } from "react";
import { Serif } from "@/shared/components";
import type { StyleProp, TextStyle } from "react-native";

interface Props {
  text: string;
  speedMs?: number;
  italic?: boolean;
  size?: number;
  style?: StyleProp<TextStyle>;
}

export function TypewriterText({ text, speedMs = 30, italic = true, size = 13, style }: Props) {
  const [shown, setShown] = useState("");
  // text 变化时在渲染期清空 (prev-prop 比较), 而非在 effect 里 setState —— 后者会多渲染
  // 一帧旧文字. prev 值只用于比较、不上屏, 故存 ref 而非 state. 见 react.dev "你可能不需要 effect".
  const prevText = useRef(text);
  if (prevText.current !== text) {
    prevText.current = text;
    setShown("");
  }

  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const tick = () => {
      if (cancelled) return;
      i++;
      setShown(text.slice(0, i));
      if (i < text.length) {
        setTimeout(tick, speedMs);
      }
    };
    const t = setTimeout(tick, speedMs);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [text, speedMs]);

  return (
    <Serif italic={italic} size={size} style={style}>
      {shown}
    </Serif>
  );
}
