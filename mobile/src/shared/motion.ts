/**
 * Motion tokens — 全 App 统一的"丝滑"手感参数, 一处调、处处变.
 *
 * 设计原则 (见 docs/技术文档/native_feel_skill/references/05-wiseflow-restraint.md § 3):
 *   克制的是装饰与庆祝, 不是运动本身。运动要丝滑、跟手、几乎不回弹
 *   —— 产品要"有重量", 不要弹跳感。
 *
 * 注: 底部灵动岛 Tab (DynamicIslandTabBar) 另有一套更软的 MORPH (damping 20),
 *   那是它"伸缩"形态的专属手感, 不走这里。
 */
import { LinearTransition } from "react-native-reanimated";

/**
 * 列表重排 / 增删时的位置过渡 —— gap 平滑闭合, 不"啪"地跳。
 * 用法: 列表行根节点 `<Animated.View layout={LIST_LAYOUT}>`。
 */
export const LIST_LAYOUT = LinearTransition.springify().damping(28).stiffness(300);

/**
 * sheet / 抽屉跟手拖拽的 spring 收尾配置 —— 快、不回弹。
 * 配合手指速度: `withSpring(target, { ...SHEET_SPRING, velocity })`。
 */
export const SHEET_SPRING = {
  damping: 28,
  stiffness: 300,
  mass: 1,
  overshootClamping: true,
} as const;
