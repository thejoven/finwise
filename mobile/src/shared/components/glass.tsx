/**
 * 底部悬浮栏的"玻璃胶囊"原语 —— tab 岛与分类格共用.
 *
 * 抽出来的理由: 底栏现在是**两颗分离的胶囊** (左「分类格」+ 右「tab 岛」), 二者要长得像
 *   一对 —— 同种玻璃材质、同样高度、同道描边. 把材质/高度/覆盖色收在这里, 两边各自
 *   引用, 避免复制粘贴走样, 也切断 `DynamicIslandTabBar` ↔ `BottomCategoryCell` 的循环引用.
 *
 * 材质: iOS 26+ 走 expo-glass-effect 的 GlassView (liquid glass), iOS 18 及以下 / Android
 *   降级到 expo-blur 的 BlurView. 玻璃作 absoluteFill 背景层, 由父胶囊的 `overflow:hidden`
 *   + `radius.full` 裁成药丸形. 跟随明暗: 玻璃用 colorScheme="auto" / 按 scheme 选 BlurView
 *   tint; 不在调色板里的 rgba 覆盖层 (描边 / 选中高亮) 走 `glassOverlay` 按明暗手动给.
 *
 * @see https://docs.expo.dev/versions/latest/sdk/glass-effect/
 */

import { StyleSheet } from "react-native";
import { GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";

import { theme } from "@/core/theme";

/** 两颗胶囊统一高度. tab 岛: paddingV 4*2 + tab 44 = 52; 分类格也取此值, 视觉成对. */
export const PILL_HEIGHT = 52;

/**
 * 玻璃表面上的"覆盖层"颜色 —— 不在调色板里的 rgba, 按明暗手动给.
 * (图标 / 文字色直接用 theme.color.ink / muted, 已是动态色, 会自动随明暗翻.)
 */
export function glassOverlay(isDark: boolean) {
  return {
    // 胶囊边缘: 收一道更明确的边 (仍属"极淡描边"范畴) —— 两颗胶囊读起来是成对的清爽玻璃.
    border: isDark ? "rgba(255,255,255,0.16)" : "rgba(0,0,0,0.10)",
    // 选中"透镜"的边: 比胶囊边更淡, 免得抢了胶囊轮廓的镜头.
    lensBorder: isDark ? "rgba(255,255,255,0.10)" : "rgba(0,0,0,0.05)",
    activeFill: isDark ? "rgba(255,255,255,0.12)" : "rgba(255,255,255,0.55)", // 选中"透镜"高亮
  };
}

/** 胶囊玻璃背景 (absoluteFill). 由父层 overflow:hidden 裁成圆角, 跟随明暗. */
export function IslandGlass({ isDark }: { isDark: boolean }) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView
        style={[StyleSheet.absoluteFill, styles.glassFill]}
        glassEffectStyle="regular"
        colorScheme="auto"
      />
    );
  }
  return (
    <BlurView
      style={[StyleSheet.absoluteFill, styles.glassFill]}
      tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      intensity={80}
    />
  );
}

const styles = StyleSheet.create({
  glassFill: {
    borderRadius: theme.radius.full, // 让 GlassView 走原生圆角, 边缘更"液态"
  },
});
