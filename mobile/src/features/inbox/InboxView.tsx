import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { SectionHeader, Serif } from "@/shared/components";
import {
  SignalRow,
  SilenceStamp,
  useInferenceDoneToast,
  useMergedSignals,
  type MergedSignal,
} from "@/features/capture";
// 走具体文件而非 "@/features/inbox" barrel: 该 barrel 同时导出本组件, 走 barrel 会形成
// inbox/index ⇄ InboxView 的自引用 require cycle. 具体路径切断回边.
import { InboxCallouts } from "@/features/inbox/Callouts";
import { theme } from "@/core/theme";
import { isSameLocalDay, isoWeekOfYear } from "@/shared/format";

/**
 * 信箱 (原「收件箱」) · 财知页内的第一张子页.
 *
 * 内容与旧 inbox 屏一致 —— server + local-pending 合并列表, 顶部沉默戳 + callouts +
 * 「本周记录」段, 下拉刷新, 每 10s 轮询看 inference_status 回写. 唯一区别: 报头/卷号戳
 * /记录入口已上移到财知 host 的固定 CaizhiHeader, 本视图不再自带 CollapsibleMasthead.
 *
 * 布局: 作为 PagerView 的一页, 顶部紧接吸顶分段栏, 故只留一点呼吸 (spacing.md);
 *   底部仍留 insets.bottom + 64 给悬浮的灵动岛 tab bar 让位.
 */
export function InboxView() {
  const insets = useSafeAreaInsets();
  const { data, refetch, isLoading } = useMergedSignals();
  const [refreshing, setRefreshing] = useState(false);

  // 监测 pending → done 跃迁, 弹 toast 通知用户 AI 推演完成
  useInferenceDoneToast(data);

  const todayCount = useMemo(
    () => data.filter((s) => isSameLocalDay(s.captured_at)).length,
    [data],
  );

  const today = useMemo(() => new Date(), []);
  const isoWeek = isoWeekOfYear(today);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const bottomPad = insets.bottom + 64;

  // 提到 useMemo: 否则每次 render 都 new 一个 RefreshControl 元素 (jsx-no-jsx-as-prop).
  const refreshControl = useMemo(
    () => (
      <RefreshControl
        refreshing={refreshing}
        onRefresh={handleRefresh}
        tintColor={theme.color.ink}
      />
    ),
    [refreshing, handleRefresh],
  );

  return (
    <View style={styles.root}>
      <FlatList<MergedSignal>
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
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
        refreshControl={refreshControl}
        contentContainerStyle={[
          { paddingTop: theme.spacing.md, paddingBottom: bottomPad },
          data.length === 0 ? styles.flexScroll : undefined,
        ]}
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
