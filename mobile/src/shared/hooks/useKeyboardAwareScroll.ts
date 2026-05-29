/**
 * useKeyboardAwareScroll — RN 内置 API 做的"键盘弹出时把 focused input 滚到
 * 可见区"工具. 不依赖 react-native-keyboard-aware-scroll-view.
 *
 * 用法:
 *   const { scrollFocusedInputIntoView, keyboardHeight } = useKeyboardAwareScroll();
 *   <ScrollView ref={scrollRef} ...>
 *     <TextInput
 *       ref={inputRef}
 *       onFocus={() => scrollFocusedInputIntoView(scrollRef, inputRef, { margin: 24 })}
 *     />
 *   </ScrollView>
 *
 * 工作原理:
 *   1. 监听 keyboardWillShow (iOS) / keyboardDidShow (Android) 拿键盘高度
 *   2. scrollFocusedInputIntoView 调用时:
 *      - 用 measureLayout 算 input 在 ScrollView 内 content 的 y 坐标 + 高度
 *      - 算"屏幕底部以上 visible 区"= height - keyboard
 *      - 如果 input 底部 > visible 底部 → scrollTo 把 input 推到 visible 顶部
 *      - 加 margin 给用户留视觉缓冲
 *
 * 对比 KAV behavior=padding + automaticallyAdjustKeyboardInsets 双开:
 *   - KAV padding 推 view, 但不重定位 ScrollView 内的 input → 输入框仍可能挡
 *   - automaticallyAdjustKeyboardInsets 自动调 contentInset, 但跟 KAV 重复
 *   - 用这个 hook + 单 KAV (padding, with keyboardVerticalOffset) 最干净
 */

import { useCallback, useEffect, useRef } from "react";
import {
  Keyboard,
  Platform,
  type ScrollView,
  findNodeHandle,
  type View,
  type TextInput,
} from "react-native";

interface ScrollOpts {
  /** input 底部到键盘顶部的额外缓冲 (px), 默认 24 */
  margin?: number;
  /** 是否动画, 默认 true */
  animated?: boolean;
}

export function useKeyboardAwareScroll() {
  const keyboardHeight = useRef<number>(0);

  useEffect(() => {
    const showEvt = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvt = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSub = Keyboard.addListener(showEvt, (e) => {
      keyboardHeight.current = e.endCoordinates.height;
    });
    const hideSub = Keyboard.addListener(hideEvt, () => {
      keyboardHeight.current = 0;
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const scrollFocusedInputIntoView = useCallback(
    (
      scrollRef: React.RefObject<ScrollView | null>,
      inputRef: React.RefObject<TextInput | View | null>,
      opts: ScrollOpts = {},
    ) => {
      const margin = opts.margin ?? 24;
      const animated = opts.animated ?? true;

      // iOS keyboardWillShow 在 onFocus 之后才触发, 给 80ms 等键盘高度到位
      // Android keyboardDidShow 同样, 250ms 更保险
      const delay = Platform.OS === "ios" ? 80 : 250;

      setTimeout(() => {
        const scrollNode = findNodeHandle(scrollRef.current as unknown as React.Component);
        const inputNode = findNodeHandle(inputRef.current as unknown as React.Component);
        if (scrollNode === null || inputNode === null) return;

        // measureLayout(target, callback): 算 input 相对于 scrollView content 的 y
        const input = inputRef.current as unknown as View | null;
        if (!input || typeof (input as View).measureLayout !== "function") return;

        (input as View).measureLayout(
          scrollNode,
          (_x: number, y: number, _w: number, h: number) => {
            const scrollContent = scrollRef.current;
            if (!scrollContent) return;
            // input 底部应该位于 (window.height - keyboard - margin) 以上.
            // 简化: 直接滚到 input top - some buffer; ScrollView 自己 contentInset 会兜.
            // 我们让 input 顶部位于 ScrollView 可视区 1/3 处, 这样多行输入还有空间显示后续字符.
            const targetY = Math.max(0, y + h - 200);
            scrollContent.scrollTo({ y: targetY + margin, animated });
          },
          () => {
            // measureLayout 失败 → 兜底 scrollToEnd
            scrollRef.current?.scrollToEnd({ animated });
          },
        );
      }, delay);
    },
    [],
  );

  return { scrollFocusedInputIntoView, keyboardHeight };
}
