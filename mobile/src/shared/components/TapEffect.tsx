/**
 * TapEffect — Pressable 替代 TouchableOpacity.
 *
 * 为什么不用 TouchableOpacity:
 *   - TO 是受控不透明度动画, 在 iOS 上不是原生反馈
 *   - 主流 RN 应用都用它, "默认 RN 感"很重
 *
 * 这个组件做的:
 *   - iOS 上按下时背景色微变 (paperPressed token)
 *   - Android 上也只用颜色变化, 不开 ripple (跨平台一致优先)
 *   - 不开 spring, 不开 scale 动画
 *
 * 触感不在这里. 触感由调用方决定 (签字才震, Tab 切换轻震, 录入不震).
 * 见 references/06-haptic-grammar.md.
 */

import { useCallback, type ReactNode } from "react";
import { Pressable, type PressableProps, type StyleProp, type ViewStyle } from "react-native";
import { theme } from "@/core/theme";

export interface TapEffectProps extends Omit<PressableProps, "children" | "style"> {
  children: ReactNode;
  /** 静止状态的样式 */
  style?: StyleProp<ViewStyle>;
  /** 按下时的覆盖样式. 默认 paperPressed 背景. */
  pressedStyle?: StyleProp<ViewStyle>;
  /** 关闭按下效果 — 极少数场景 (大文字 link) */
  disableEffect?: boolean;
}

export function TapEffect({
  children,
  style,
  pressedStyle,
  disableEffect = false,
  ...props
}: TapEffectProps) {
  const computeStyle = useCallback(
    ({ pressed }: { pressed: boolean }): StyleProp<ViewStyle> => {
      if (!pressed || disableEffect) return style;
      const defaultPressed: ViewStyle = {
        backgroundColor: theme.color.paperPressed,
      };
      return [style, defaultPressed, pressedStyle];
    },
    [style, pressedStyle, disableEffect],
  );

  return (
    <Pressable android_ripple={null} style={computeStyle} {...props}>
      {children}
    </Pressable>
  );
}
