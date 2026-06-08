import { useCallback, useEffect, useRef } from "react";
import { StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { useSharedValue } from "react-native-reanimated";
import PagerView, {
  type PagerViewOnPageScrollEventData,
  type PagerViewOnPageSelectedEventData,
} from "react-native-pager-view";

import { InboxView } from "@/features/inbox";
import { DenoiseView } from "@/features/capture";
import { ArchiveView } from "@/features/archive";
import { haptic } from "@/core/haptics";
import { theme } from "@/core/theme";

import { CaizhiHeader } from "./CaizhiHeader";
import { SegmentedTabs } from "./SegmentedTabs";
import { useCaizhiNav } from "./store";

/**
 * 财知 tab —— 信箱 · 降噪 · 归档 合三为一 (本轮整合, 见 GOAL).
 *
 * 结构: 固定报头 (CaizhiHeader) + 吸顶分段栏 (SegmentedTabs) + 原生 PagerView 三页.
 *   报头与分段栏是 pager 的兄弟节点, 天然常驻在顶部, 无需 sticky / absolute 协调; 三张子页
 *   在其下方各自独立滚动.
 *
 * 滑动: 用 react-native-pager-view (iOS UIPageViewController / Android ViewPager2), 左右滑动
 *   是真·原生手感与回弹. onPageScroll 把 `position + offset` 喂给 `progress` 共享值, 驱动
 *   分段栏下划线跟手; onPageSelected (滑动落定 / 点击 setPage 都会触发) 给一次 selection 触感.
 *
 * 初始落在第 0 页「信箱」(原收件箱), 与 app 启动落 caizhi 一致.
 */

const TABS = ["信箱", "降噪", "归档"] as const;

export default function CaizhiScreen() {
  const pagerRef = useRef<PagerView>(null);
  const progress = useSharedValue(0);

  const onPageScroll = useCallback(
    (e: NativeSyntheticEvent<PagerViewOnPageScrollEventData>) => {
      progress.value = e.nativeEvent.position + e.nativeEvent.offset;
    },
    [progress],
  );

  const onPageSelected = useCallback(
    (_e: NativeSyntheticEvent<PagerViewOnPageSelectedEventData>) => {
      void haptic.selection();
    },
    [],
  );

  const handleSelect = useCallback((index: number) => {
    pagerRef.current?.setPage(index);
  }, []);

  // 底栏长按「财知」菜单的跳转请求落地: 跳到对应子页后清空 pending.
  //   推迟到 rAF 再 setPage —— 跨 tab 首次跳进来时 pager 可能刚挂载、ref 尚未就绪; clear 也放
  //   rAF 内 (而非同步), 否则同步改 store 会触发本 effect 的 cleanup 把这次 rAF 取消掉 (竞态).
  const pendingPage = useCaizhiNav((s) => s.pendingPage);
  useEffect(() => {
    if (pendingPage == null) return;
    const target = pendingPage;
    requestAnimationFrame(() => {
      pagerRef.current?.setPage(target);
      useCaizhiNav.getState().clear();
    });
  }, [pendingPage]);

  return (
    <View style={styles.root}>
      <CaizhiHeader />
      <SegmentedTabs tabs={TABS} progress={progress} onSelect={handleSelect} />
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageScroll={onPageScroll}
        onPageSelected={onPageSelected}
      >
        <View key="inbox" style={styles.page} collapsable={false}>
          <InboxView />
        </View>
        <View key="signals" style={styles.page} collapsable={false}>
          <DenoiseView />
        </View>
        <View key="archive" style={styles.page} collapsable={false}>
          <ArchiveView />
        </View>
      </PagerView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  pager: {
    flex: 1,
  },
  page: {
    flex: 1,
  },
});
