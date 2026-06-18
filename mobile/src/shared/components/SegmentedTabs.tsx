import { StyleSheet, Text as RNText, View, type LayoutChangeEvent } from "react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

import { TapEffect } from "./TapEffect";
import { theme, useThemeColors } from "@/core/theme";

/**
 * 通用吸顶分段栏 —— 与下方 PagerView 双向同步. 财知 (信箱·降噪·归档·统计) 与标的
 *   (标的·信号·订阅) 等多页宿主共用; 段数随传入 tabs 自适应 (等宽 flex:1).
 *
 * 与下方 PagerView 双向同步:
 *   · 滑动: host 把 pager 的 `position + offset` 写进 `progress` 共享值, 下划线**跟手**滑动,
 *     标签透明度按到 progress 的距离连续淡入淡出 (active 实, 远端淡), 全程在 UI 线程跑.
 *   · 点击: 调 `onSelect(i)` → host `pagerRef.setPage(i)`, 触发原生翻页 + selection 触感.
 *
 * 几何: 各段等宽 (flex:1), 段宽 segW 由 onLayout 量出存进共享值, 下划线落点 = progress×segW
 *   居中. 底部一道 hairline 收边 (与报头折叠态的收底线一脉相承, 分隔报头区与内容).
 *
 * 字体走 cjkBold 裸 RNText —— 与刊名 / 底栏标签同款, 属常驻 chrome (参 DynamicIslandTabBar).
 */

const UNDERLINE_W = 24;
const ROW_H = 44;

export function SegmentedTabs({
  tabs,
  progress,
  onSelect,
}: {
  tabs: readonly string[];
  progress: SharedValue<number>;
  onSelect: (index: number) => void;
}) {
  const segW = useSharedValue(0);

  // Reanimated 不认 DynamicColorIOS 动态色 → 下划线底色取 resolved hex.
  const c = useThemeColors();

  const onLayout = (e: LayoutChangeEvent) => {
    segW.value = e.nativeEvent.layout.width / tabs.length;
  };

  const underlineStyle = useAnimatedStyle(() => ({
    // segW 量出前 (首帧) 先藏起来, 免得下划线从错误落点 (-W/2) 闪一下.
    opacity: segW.value > 0 ? 1 : 0,
    transform: [{ translateX: progress.value * segW.value + (segW.value - UNDERLINE_W) / 2 }],
  }));

  return (
    <View style={styles.row} onLayout={onLayout}>
      {tabs.map((label, i) => (
        <Segment
          key={label}
          label={label}
          index={i}
          progress={progress}
          onPress={() => onSelect(i)}
        />
      ))}
      <Animated.View
        pointerEvents="none"
        style={[styles.underline, { backgroundColor: c.ink }, underlineStyle]}
      />
    </View>
  );
}

function Segment({
  label,
  index,
  progress,
  onPress,
}: {
  label: string;
  index: number;
  progress: SharedValue<number>;
  onPress: () => void;
}) {
  // 标签随到 progress 的距离连续淡: active(距 0) 实, 相邻(距 1) 淡到 0.4.
  const labelStyle = useAnimatedStyle(() => {
    const d = Math.min(Math.abs(progress.value - index), 1);
    return { opacity: 1 - d * 0.6 };
  });

  return (
    <TapEffect
      onPress={onPress}
      style={styles.seg}
      accessibilityRole="button"
      accessibilityLabel={label}
    >
      <Animated.View style={labelStyle}>
        <RNText allowFontScaling={false} style={styles.label}>
          {label}
        </RNText>
      </Animated.View>
    </TapEffect>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    height: ROW_H,
    backgroundColor: theme.color.paper,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ink,
  },
  seg: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    fontFamily: theme.fontFamily.cjkBold,
    fontSize: 14,
    lineHeight: 18,
    letterSpacing: 2,
    color: theme.color.ink,
  },
  underline: {
    position: "absolute",
    left: 0,
    bottom: 0,
    width: UNDERLINE_W,
    height: 2,
    borderRadius: 1,
    // backgroundColor 内联 resolved hex — Reanimated 不认动态色.
  },
});
