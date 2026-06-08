/**
 * 原生 SwiftUI UI 接入点 (@expo/ui) —— 全 App 唯一的探测 + 载入处.
 *
 * @expo/ui 是 **原生**模块: 只有 `expo prebuild` + 原生重建后, 二进制里才有 'ExpoUI' 原生
 * 模块. Expo Go / 未重建的 dev client 里没有 —— 此时连 import 它的 barrel 顶层都会抛 (barrel
 * 在求值期就 `requireNativeView('ExpoUI', …)`). 故先用 `requireOptionalNativeModule` 探测:
 * 在 → `require` 真控件; 不在 (含 Android / web) → 保持 null, 各 wrapper 优雅回退到 RN 自绘.
 * 原生装好后无需改 JS, 控件自动点亮.
 *
 * 历史上这段探测在 profile.tsx 与 TabContextMenu.ios.tsx 各抄了一遍, 现收口到此一处. 新增
 * 用原生控件的地方, 一律从这里取 `UI` / `MODS` / `hasNativeUI`, 不再各自 require.
 *
 * @see https://docs.expo.dev/guides/expo-ui-swift-ui/
 */
import { LogBox } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

export type ExpoUI = typeof import("@expo/ui/swift-ui");
export type ExpoUIModifiers = typeof import("@expo/ui/swift-ui/modifiers");

/**
 * 噪音静音: `@expo/ui/swift-ui` 是 barrel, 顶层 `export * from './BottomSheet'` 会在求值时跑
 * `requireNativeView('ExpoUI','BottomSheetView')`. 当二进制的 ExpoUI pod 偏旧、尚无
 * BottomSheetView (JS 端已是更新的 canary, package.json 仍锁 ~0.2.0-beta.9), expo-modules-core
 * 会在 __DEV__ 下 warn 一条. 全 App 没人渲染 BottomSheet, 纯属噪音 —— 精确静音这一条 (只匹配
 * BottomSheetView; 其它控件真缺失时仍照常报警, 不掩盖真问题). 须在 require barrel 之前调用,
 * 否则 warn 已先打出. 治本: 对齐 @expo/ui 版本并重建原生.
 */
LogBox.ignoreLogs([/native view manager for module\(ExpoUI\).*BottomSheetView/]);

let ui: ExpoUI | null = null;
let mods: ExpoUIModifiers | null = null;

if (requireOptionalNativeModule("ExpoUI")) {
  ui = require("@expo/ui/swift-ui") as ExpoUI;
  mods = require("@expo/ui/swift-ui/modifiers") as ExpoUIModifiers;
}

/** 原生 SwiftUI 命名空间. `hasNativeUI` 为 false 时为 null —— 用前必判 (或经 wrapper). */
export const UI = ui;

/** 原生 SwiftUI 修饰符. `hasNativeUI` 为 false 时为 null. */
export const MODS = mods;

/** 原生 SwiftUI 控件是否可用 (iOS + 已原生重建). 为 false 时各 wrapper 走 RN 回退. */
export const hasNativeUI = ui != null && mods != null;
