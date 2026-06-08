import {
  StyleSheet,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from "react-native";

import { theme } from "@/core/theme";
import { UI, MODS, hasNativeUI } from "./expoUI";

/**
 * 单行 / 多行文本输入 —— 原生优先, RN 兜底.
 *
 * · iOS + 已原生重建: 真·原生 SwiftUI `TextField` / `SecureField` (@expo/ui). 这是把"输入"
 *   交给系统的示范面 —— 原生输入自带听写、系统键盘配件、密码/邮箱自动填充、选区手势, 这些
 *   恰是"输入"场景里用户最期待原生行为的地方 (与外观分段控件同理, 见 profile.tsx).
 * · 其他情况 (Android / Expo Go / 未 rebuild): 原样的 RN `<TextInput>`, 视觉与改动前逐像素一致
 *   —— 故这层切换对当前二进制零回归, 原生重建后自动点亮.
 *
 * 编排约定: 编辑栏的"底部一道细线 + 上下留白"是报刊式输入的一部分 (非系统装饰), 故由本组件的
 * 外层 `View` 承载 (原生 / 兜底两条路都套), 只把**输入控件本身**换成原生. 字体: 原生路径让系统
 * 用 label / SF 字 (动态明暗、可访问性放大都自动), 不强塞 bundle 的 Source Serif —— 输入框用
 * 系统字本就更"原生", 与正文 Serif 的"展示"诉求不冲突.
 *
 * ⚠️ 原生 `TextField` 是**非受控**组件 (只认 `defaultValue` + `onChangeText`). 这里仍把状态留在
 * 父级的 `useState`, 由 `onChangeText` 单向回灌 —— 父值被字段驱动, 二者天然同步. 若需父侧强制
 * 清空 / 重置, 给本组件换 `key`. (`maxLength` 仅 RN 兜底路径强制 —— 原生无此 prop, 由后端兜底.)
 */

/** RN 与 @expo/ui 都接受的键盘类型交集 (本 App 只用到这几种). */
type FieldKeyboardType = "default" | "email-address" | "numeric" | "url";

export interface NativeFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** true → 密码框 (原生走 SecureField, 兜底走 secureTextEntry). 与 multiline 互斥. */
  secure?: boolean;
  /** true → 多行 (签名/备注). */
  multiline?: boolean;
  keyboardType?: FieldKeyboardType;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  autoCorrect?: boolean;
  /** 挂载即聚焦 (搜索框等). */
  autoFocus?: boolean;
  /** true → 不套默认外壳 (上下留白 + 底部细线), 由 `containerStyle` 自带壳 (搜索行 / 盒式输入). */
  bare?: boolean;
  /** 自动填充提示 —— 仅 RN 兜底路径生效 (原生 SecureField/TextField 暂不透此 prop). */
  autoComplete?: TextInputProps["autoComplete"];
  textContentType?: TextInputProps["textContentType"];
  returnKeyType?: TextInputProps["returnKeyType"];
  /** 字数上限 —— 仅 RN 兜底强制 (原生无此 prop). */
  maxLength?: number;
  /** 输入区最小高度 (多行用) —— 两路都套在容器上, 保住"方框"手感. */
  minHeight?: number;
  /** 回车键提交 (原生 onSubmit / 兜底 onSubmitEditing). 多行下慎用. */
  onSubmit?: () => void;
  /** 覆盖外层容器样式 (默认: 上下留白 + 底部细线). */
  containerStyle?: StyleProp<ViewStyle>;
  /** 覆盖 RN 兜底 `<TextInput>` 的文本样式 (默认: 报刊 Serif 16). 原生路径不吃此样式. */
  inputStyle?: StyleProp<TextStyle>;
}

export function NativeField({
  value,
  onChangeText,
  placeholder,
  secure = false,
  multiline = false,
  keyboardType = "default",
  autoCapitalize = "none",
  autoCorrect = false,
  autoFocus = false,
  bare = false,
  autoComplete,
  textContentType,
  returnKeyType,
  maxLength,
  minHeight,
  onSubmit,
  containerStyle,
  inputStyle,
}: NativeFieldProps) {
  const minH = minHeight ? { minHeight } : null;
  const shell = bare ? [minH, containerStyle] : [styles.container, minH, containerStyle];

  // ── 原生 SwiftUI 路径 ──────────────────────────────────────────────
  if (hasNativeUI && UI && MODS) {
    const { Host, TextField, SecureField } = UI;
    const { textFieldStyle } = MODS;
    const common = {
      defaultValue: value,
      placeholder,
      onChangeText,
      keyboardType,
      autoFocus,
      onSubmit: onSubmit ? () => onSubmit() : undefined,
      modifiers: [textFieldStyle("plain")],
    };
    return (
      <View style={shell}>
        {/* 单行: matchContents 仅竖向 (高度随字高, 宽度由 RN 布局撑满整列).
            多行: Host 充满容器 (容器已有 minHeight), 字段自顶向下填. */}
        <Host
          matchContents={multiline ? undefined : { vertical: true }}
          style={multiline ? styles.hostFill : styles.host}
        >
          {secure ? (
            <SecureField {...common} />
          ) : (
            <TextField {...common} autocorrection={autoCorrect} multiline={multiline} />
          )}
        </Host>
      </View>
    );
  }

  // ── RN 兜底路径 (与改动前逐像素一致) ───────────────────────────────
  return (
    <View style={shell}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.color.muted2}
        secureTextEntry={secure}
        multiline={multiline}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        autoCorrect={autoCorrect}
        autoFocus={autoFocus}
        autoComplete={autoComplete}
        textContentType={textContentType}
        returnKeyType={returnKeyType}
        maxLength={maxLength}
        onSubmitEditing={onSubmit}
        style={[styles.input, multiline && styles.inputMultiline, minH, inputStyle]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // 报刊式输入栏: 上下留白 + 一道收底细线 (原 formFieldStyles.input 的非文本部分).
  container: {
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
  },
  host: { alignSelf: "stretch" },
  hostFill: { flex: 1, alignSelf: "stretch" },
  // RN 兜底文本样式 (原 formFieldStyles.input 的文本部分).
  input: {
    fontFamily: theme.fontFamily.serifRegular,
    fontSize: 16,
    lineHeight: 24,
    color: theme.color.ink,
    padding: 0,
  },
  inputMultiline: { textAlignVertical: "top" },
});
