// 原生 SwiftUI (@expo/ui) 接入层 —— 探测 + 优雅回退的 wrapper 都从这里出.
// 约定: 业务代码用这些 wrapper / 标志, 不直接 require("@expo/ui/...").

export { UI, MODS, hasNativeUI } from "./expoUI";
export type { ExpoUI, ExpoUIModifiers } from "./expoUI";

export { NativeField } from "./NativeField";
export type { NativeFieldProps } from "./NativeField";
