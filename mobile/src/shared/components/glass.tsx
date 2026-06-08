/**
 * 底部悬浮栏的"玻璃胶囊"原语 —— tab 岛与分类格共用.
 *
 * 抽出来的理由: 底栏现在是**两颗分离的胶囊** (左「分类格」+ 右「tab 岛」), 二者要长得像
 *   一对 —— 同种玻璃材质、同样高度、同道描边. 把材质/高度/覆盖色收在这里, 两边各自
 *   引用, 避免复制粘贴走样, 也切断 `DynamicIslandTabBar` ↔ `BottomCategoryCell` 的循环引用.
 *
 * 材质: iOS 26+ 走 expo-glass-effect 的 GlassView (liquid glass), iOS 18 及以下 / Android
 *   降级到 expo-blur 的 BlurView.
 *
 * 容器而非背景 (本轮改): `IslandGlass` 现在**包裹**内容 (children 嵌在玻璃里), 不再是
 *   absoluteFill 背景层. 改这一下是为了吃到 iOS 26 的"交互玻璃" —— `isInteractive` 让玻璃
 *   对按压/长按起液态反应 (轻微缩放 + 微光跟手). 但这反应要求触摸**落到玻璃自身**:
 *   expo-glass-effect 把子视图挂进原生 `glassEffectView.contentView`, 故内容嵌在 GlassView
 *   内时, 触摸才会沿响应链冒泡到玻璃的交互手势. 旧版玻璃铺在内容下面 (兄弟层), 触摸被
 *   上层 Pressable 截走, 玻璃永远收不到 → isInteractive 形同虚设.
 *
 * 圆角由 GlassView 原生处理 (borderRadius → cornerConfiguration, 见原生 GlassView.swift).
 *   描边 (borderWidth/borderColor) 仍交给**外层 RCTView** 画: GlassView 只认圆角一类 prop
 *   (见原生 GlassEffectModule), 不处理 borderWidth, 描在它上面不出线. 跟随明暗: 玻璃
 *   colorScheme="auto"; BlurView 按 scheme 选 tint. 非调色板 rgba (描边/选中高亮) 走 `glassOverlay`.
 *
 * @see https://docs.expo.dev/versions/latest/sdk/glass-effect/
 */

import { type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import Animated from "react-native-reanimated";
import { GlassContainer, GlassView, isLiquidGlassAvailable } from "expo-glass-effect";
import { BlurView } from "expo-blur";

/** 选中"透镜"要随 tab 滑动, 故包成可动画的原生玻璃视图 (reanimated 直接驱动其 transform). */
const AnimatedGlassView = Animated.createAnimatedComponent(GlassView);

/** 两颗胶囊统一高度. tab 岛: paddingV 4*2 + tab 44 = 52; 分类格也取此值, 视觉成对. */
export const PILL_HEIGHT = 52;

/**
 * 胶囊圆角 = 半高 —— 让左右两侧成**完全圆形**(真半圆), 两颗胶囊共用.
 *
 * 为什么钉成 PILL_HEIGHT/2 而非 radius.full(9999): 液态玻璃 GlassView 按 borderRadius 的
 *   字面值生成玻璃形状, 不像普通 CALayer 会把超大值夹到半高, 9999 下两端会渲染成圆角矩形
 *   而非正圆. 钉成半高 (= 26) 是 iOS capsule 的规范值, 左右两侧必为完整半圆.
 */
export const PILL_RADIUS = PILL_HEIGHT / 2;

/**
 * 胶囊玻璃容器 —— 把 children 包进玻璃里 (圆角由本层处理; 描边交外层 RCTView 画).
 *
 * `style` 应带 borderRadius (让 GlassView 走原生圆角, 边缘更"液态") + 内容的尺寸/排布.
 *
 * @param isInteractive iOS 26 交互玻璃: 按压/长按时玻璃液态反应 (缩放 + 微光). 仅 liquid
 *   glass 路径生效; 降级的 BlurView 无此特效 (这是 iOS 26 原生材质能力, 旧系统给不了).
 */
export function IslandGlass({
  isDark,
  isInteractive = false,
  style,
  children,
}: {
  isDark: boolean;
  isInteractive?: boolean;
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
}) {
  if (isLiquidGlassAvailable()) {
    return (
      <GlassView
        style={style}
        glassEffectStyle="regular"
        colorScheme="auto"
        isInteractive={isInteractive}
      >
        {children}
      </GlassView>
    );
  }
  return (
    <BlurView
      style={style}
      tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
      intensity={80}
    >
      {children}
    </BlurView>
  );
}

/** 选中"透镜"几何 (绝对定位 + 圆角) —— 由 DynamicIslandTabBar 按等宽栅格算好传入. */
export interface LensGeom {
  left: number;
  top: number;
  width: number;
  height: number;
  radius: number;
}

/**
 * tab 岛的**玻璃背景层** —— 胶囊 + 会滑动的选中"透镜"作为**兄弟**收进同一个原生
 *   `GlassContainer` (UIGlassContainerEffect). 容器让二者按 `spacing` 距离**原生粘连/形变**:
 *   透镜滑动时与胶囊像液体一样相吸、伸缩 —— 即 iOS 26 那种灵动的玻璃选中块. (旧版透镜是
 *   直接嵌在胶囊玻璃里的"玻璃叠玻璃", 不融合, 易发灰发平 —— 这就是本轮要修的.)
 *
 * 为什么玻璃单独成层 (背景), tab 内容铺在它之上: 容器的融合只发生在**兄弟玻璃**之间, 故胶囊
 *   与透镜必须同级、中间不夹内容. 代价: 胶囊不再包内容, 那个按压发亮 (isInteractive) 随之去掉
 *   (它要求触摸落到胶囊玻璃, 与"内容在玻璃上层"互斥; 且本是早期误读出来的需求).
 *
 * 透镜走可动画 GlassView, 由父传入的 `lensAnimatedStyle` (translateX) 驱动滑动, 带一点 `tint`
 *   让它在胶囊上可辨. 降级 (无液态玻璃): 模糊胶囊 + rgba 透镜, 退回平面高亮 (无融合).
 */
export function TabBarGlass({
  isDark,
  capsuleRadius,
  lens,
  lensAnimatedStyle,
  lensTint,
  lensFallback,
  lensBorderColor,
  spacing,
}: {
  isDark: boolean;
  capsuleRadius: number;
  lens: LensGeom;
  /** reanimated 动画样式 (透镜 translateX), 由父按选中 index 驱动. */
  lensAnimatedStyle: StyleProp<ViewStyle>;
  /** iOS 26 玻璃路径: 透镜玻璃的染色 (淡, 让材质透出). */
  lensTint: string;
  /** 降级路径: 透镜纯色填充 (偏实, 保证可见). */
  lensFallback: string;
  lensBorderColor: string;
  /** GlassContainer 融合距离 (透镜与胶囊在此距离内开始粘连). */
  spacing: number;
}) {
  const lensBase: ViewStyle = {
    position: "absolute",
    left: lens.left,
    top: lens.top,
    width: lens.width,
    height: lens.height,
    borderRadius: lens.radius,
  };
  if (isLiquidGlassAvailable()) {
    return (
      <GlassContainer spacing={spacing} style={StyleSheet.absoluteFill} pointerEvents="none">
        <GlassView
          style={[StyleSheet.absoluteFill, { borderRadius: capsuleRadius }]}
          glassEffectStyle="regular"
          colorScheme="auto"
        />
        <AnimatedGlassView
          style={[lensBase, lensAnimatedStyle]}
          glassEffectStyle="regular"
          colorScheme="auto"
          tintColor={lensTint}
        />
      </GlassContainer>
    );
  }
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <BlurView
        style={[StyleSheet.absoluteFill, { borderRadius: capsuleRadius }]}
        tint={isDark ? "systemChromeMaterialDark" : "systemChromeMaterialLight"}
        intensity={80}
      />
      <Animated.View
        style={[
          lensBase,
          {
            borderWidth: StyleSheet.hairlineWidth,
            borderColor: lensBorderColor,
            backgroundColor: lensFallback,
          },
          lensAnimatedStyle,
        ]}
      />
    </View>
  );
}
