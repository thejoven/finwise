import { useCallback, useMemo, useState } from "react";
import { RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Animated, {
  useAnimatedScrollHandler,
  useSharedValue,
} from "react-native-reanimated";
import { router } from "expo-router";

import {
  CollapsibleMasthead,
  COLLAPSIBLE_MASTHEAD_EXPANDED,
  SectionHeader,
  Serif,
} from "@/shared/components";
import {
  SignalRow,
  SilenceStamp,
  chineseMonthDay,
  chineseWeekday,
  isSameLocalDay,
  isoWeekOfYear,
  useMergedSignals,
  type MergedSignal,
} from "@/features/capture";
import { InboxCallouts } from "@/features/inbox";
import { theme } from "@/core/theme";

/**
 * A1 收件箱 (M4).
 *
 * - Animated.FlatList 渲染 server + local-pending 合并的列表
 * - 顶部 CollapsibleMasthead 浮层 absolute, 滚动时折叠 (跟 archive 一样)
 * - 下拉刷新触发 refetch
 * - useMergedSignals 内部每 10s 轮询, 看 inference_status 是否回写
 * - 空状态文案接纳式, 不催促
 *
 * 关于 paddingBottom: NativeTabs 在 iOS 是原生 UITabBarController, 这里手动给
 * ScrollView 加足够 paddingBottom (tab bar ~49 + safe-area bottom), 否则最后一条
 * 会被半透明 glass tab bar 盖住. Android 同理 (Material 56dp).
 */
export default function InboxScreen() {
  const insets = useSafeAreaInsets();
  const { data, refetch, isLoading } = useMergedSignals();
  const [refreshing, setRefreshing] = useState(false);

  const todayCount = useMemo(
    () => data.filter((s) => isSameLocalDay(s.captured_at)).length,
    [data],
  );

  const today = useMemo(() => new Date(), []);
  const isoWeek = isoWeekOfYear(today);
  const monthDay = chineseMonthDay(today);
  const weekday = chineseWeekday(today);

  const scrollY = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler({
    onScroll: (event) => {
      scrollY.value = event.contentOffset.y;
    },
  });

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const headerPad = insets.top + COLLAPSIBLE_MASTHEAD_EXPANDED;
  const bottomPad = insets.bottom + 64; // 给 NativeTabs glass bar 让出空间

  return (
    <View style={styles.root}>
      <Animated.FlatList<MergedSignal>
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        onScroll={onScroll}
        scrollEventThrottle={16}
        ListHeaderComponent={
          <View>
            <SilenceStamp todayCount={todayCount} edition={isoWeek} />
            <InboxCallouts />
            {data.length > 0 ? (
              <View style={styles.section}>
                <SectionHeader label="本周记录" meta={`${data.length} 条 · 全部已归档`} />
              </View>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Serif size={13} italic style={styles.emptyText}>
              {isLoading ? "正在拉取记录…" : "这里会显示你的观察记录。\n它们不需要立即写下来。"}
            </Serif>
          </View>
        }
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.color.ink}
            progressViewOffset={headerPad}
          />
        }
        contentContainerStyle={[
          { paddingTop: headerPad, paddingBottom: bottomPad },
          data.length === 0 ? styles.flexScroll : undefined,
        ]}
      />
      <CollapsibleMasthead
        volume="I"
        edition={String(isoWeek)}
        date={monthDay}
        weekday={weekday}
        onMenuPress={() => router.push("/colophon")}
        onCapturePress={() => router.push("/capture")}
        scrollY={scrollY}
      />
    </View>
  );
}

const keyExtractor = (item: MergedSignal) => item.id;
const renderItem = ({ item }: { item: MergedSignal }) => <SignalRow signal={item} />;
const Separator = () => <View style={styles.sep} />;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  section: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  sep: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: theme.color.ruleSoft,
    marginHorizontal: theme.spacing.lg,
  },
  empty: {
    flex: 1,
    paddingTop: theme.spacing.xxxl,
    paddingHorizontal: theme.spacing.lg,
  },
  emptyText: {
    color: theme.color.muted,
  },
  flexScroll: {
    flexGrow: 1,
  },
});
