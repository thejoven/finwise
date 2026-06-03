import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Display, DoubleRule, Serif } from "@/shared/components";
import { DenoisedRow, useAllSignals, type MergedSignal } from "@/features/capture";
import { theme } from "@/core/theme";

/**
 * 降噪 tab · 降噪后推断、分析过的金融信号 (跨所有分类, 按时间倒序).
 *
 * 和收件箱不同: 收件箱把原始观察放主位; 这里只收"降噪后推演出相关标的"的信号
 * (server has_targets 过滤), 每行用 DenoisedRow 把"分析判断 + 各受益标的"放主位,
 * 原始观察只作小脚注 —— 看见自己 (哲学 6). 不是 dashboard, 不堆统计 / streak / 角标.
 *
 * - useAllSignals: useInfiniteQuery, before 游标翻页 (每页 30)
 * - SignalRow 复用 (点一行自己 router.push 到信号详情)
 * - 翻页 / 拉取用文字态, 不用 spinner (跟 inbox 一致)
 * - paddingBottom = insets.bottom + 64, 给悬浮的灵动岛 tab bar 让位
 */
export default function SignalsScreen() {
  const insets = useSafeAreaInsets();
  const { data, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAllSignals();
  const [refreshing, setRefreshing] = useState(false);

  const signals: MergedSignal[] = useMemo(
    () =>
      (data?.pages ?? [])
        .flatMap((p) => p.signals)
        .map((s) => ({
          id: s.id,
          raw_text: s.raw_text,
          captured_at: s.captured_at,
          inference_status: s.inference_status,
          inference_summary: s.inference_summary,
          inference_tags: s.inference_tags,
          project_id: s.project_id,
          related_assets: s.related_assets,
        })),
    [data],
  );

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await refetch();
    } finally {
      setRefreshing(false);
    }
  }, [refetch]);

  const onEndReached = useCallback(() => {
    if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const bottomPad = insets.bottom + 64;

  return (
    <View style={styles.root}>
      <FlatList<MergedSignal>
        data={signals}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={[styles.header, { paddingTop: insets.top + theme.spacing.xl }]}>
            <Display size={30}>降噪</Display>
            <Serif size={13} italic style={styles.subtitle}>
              推断、分析后的金融信号，按时间倒序。
            </Serif>
            <View style={styles.rule}>
              <DoubleRule />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Serif size={13} italic style={styles.emptyText}>
              {isLoading
                ? "正在拉取记录…"
                : "还没有推演出标的的信号。\nAI 把你的观察降噪出标的后，会出现在这里。"}
            </Serif>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <Serif size={12} italic style={styles.footerText}>
                更早的记录…
              </Serif>
            </View>
          ) : null
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={handleRefresh}
            tintColor={theme.color.ink}
          />
        }
        contentContainerStyle={[
          { paddingBottom: bottomPad },
          signals.length === 0 ? styles.flexScroll : undefined,
        ]}
      />
    </View>
  );
}

const keyExtractor = (item: MergedSignal) => item.id;
const renderItem = ({ item }: { item: MergedSignal }) => <DenoisedRow signal={item} />;
const Separator = () => <View style={styles.sep} />;

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    paddingHorizontal: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
  },
  subtitle: {
    color: theme.color.muted,
    marginTop: theme.spacing.xs,
  },
  rule: {
    marginTop: theme.spacing.md,
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
  footer: {
    paddingVertical: theme.spacing.lg,
    alignItems: "center",
  },
  footerText: {
    color: theme.color.muted,
  },
  flexScroll: {
    flexGrow: 1,
  },
});
