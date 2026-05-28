/**
 * Typewriter — 文字 chunk-by-chunk 显示, 不闪 spinner.
 *
 * 用法:
 *   <TypewriterText text="正在出下一题..." />
 *
 * 默认 30ms 一个字符, 出完不再循环. 重新挂载会重出.
 */

import { useEffect, useState } from "react";
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

  useEffect(() => {
    setShown("");
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
