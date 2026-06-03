import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAnimatedScrollHandler, useSharedValue } from "react-native-reanimated";

import { COLLAPSIBLE_MASTHEAD_EXPANDED } from "@/shared/components/CollapsibleMasthead";

/**
 * CollapsibleMasthead 屏(inbox / archive)的滚动接线 —— 两屏共用同一套:
 *   - scrollY:   传给 <CollapsibleMasthead scrollY={...}> 算折叠进度的共享值
 *   - onScroll:  挂到 Animated.ScrollView / Animated.FlatList 的 onScroll
 *                (记得配 scrollEventThrottle={16})
 *   - headerPad: 列表顶部留白, 让首条内容从 absolute 浮层 masthead 下方开始
 *   - bottomPad: 底部留白, 给 NativeTabs 半透明 glass bar 让位 (否则末条被盖住)
 *
 * 注: profile tab 不用本 hook —— 它没有 CollapsibleMasthead, 且 bottomPad 另有算法.
 */
export function useCollapsibleScroll() {
  const insets = useSafeAreaInsets();
  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });
  const headerPad = insets.top + COLLAPSIBLE_MASTHEAD_EXPANDED;
  const bottomPad = insets.bottom + 64; // 给 NativeTabs glass bar 让出空间
  return { scrollY, onScroll, headerPad, bottomPad };
}
