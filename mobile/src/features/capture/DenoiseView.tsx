import { useCallback, useMemo, useState } from "react";
import { FlatList, RefreshControl, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";

import { DoubleRule, Serif, TAB_BAR_CLEARANCE } from "@/shared/components";
// 走具体文件而非 "@/features/capture" barrel: 该 barrel 同时导出本组件, 走 barrel 会形成
// capture/index ⇄ DenoiseView 的自引用 require cycle. 具体路径切断回边.
import { DenoisedRow } from "@/features/capture/DenoisedRow";
import { useAllSignals, type MergedSignal } from "@/features/capture/hooks";
import { theme } from "@/core/theme";

/**
 * 降噪 · 财知页第二张子页 · 降噪后推断、分析过的金融信号 (跨所有分类, 按时间倒序).
 *
 * 和信箱不同: 信箱把原始观察放主位; 这里只收"降噪后推演出相关标的"的信号
 * (server has_targets 过滤), 每行用 DenoisedRow 把"分析判断 + 各受益标的"放主位,
 * 原始观察只作小脚注 —— 看见自己 (哲学 6). 不是 dashboard, 不堆统计 / streak / 角标.
 *
 * 与旧 signals 屏唯一区别: 去掉大号「降噪」标题 (分段栏已标注), 只留一行 italic 副题;
 *   作为 PagerView 一页, 顶部紧接吸顶分段栏, 故无 safe-area top 留白.
 *
 * - useAllSignals: useInfiniteQuery, before 游标翻页 (每页 30)
 * - 翻页 / 拉取用文字态, 不用 spinner (跟信箱一致)
 * - paddingBottom = insets.bottom + TAB_BAR_CLEARANCE, 给悬浮的灵动岛 tab bar 让位
 */
export function DenoiseView() {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const { data, isLoading, refetch, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useAllSignals();
  const [refreshing, setRefreshing] = useState(false);

  const signals: MergedSignal[] = useMemo(
    () =>
      // flatMap 一次走完: 把各页 signals 摊平的同时直接 reshape, 避免再 .map 二次遍历.
      (data?.pages ?? []).flatMap((p) =>
        p.signals.map((s) => ({
          id: s.id,
          raw_text: s.raw_text,
          captured_at: s.captured_at,
          inference_status: s.inference_status,
          inference_summary: s.inference_summary,
          inference_tags: s.inference_tags,
          project_id: s.project_id,
          related_assets: s.related_assets,
        })),
      ),
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

  const bottomPad = insets.bottom + TAB_BAR_CLEARANCE;

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
        data={signals}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        ItemSeparatorComponent={Separator}
        ListHeaderComponent={
          <View style={styles.header}>
            <Serif size={13} italic style={styles.subtitle}>
              {t("capture.denoise.subtitle")}
            </Serif>
            <View style={styles.rule}>
              <DoubleRule />
            </View>
          </View>
        }
        ListEmptyComponent={
          <View style={styles.empty}>
            <Serif size={13} italic style={styles.emptyText}>
              {isLoading ? t("capture.denoise.loading") : t("capture.denoise.empty")}
            </Serif>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View style={styles.footer}>
              <Serif size={12} italic style={styles.footerText}>
                {t("capture.denoise.earlier")}
              </Serif>
            </View>
          ) : null
        }
        onEndReached={onEndReached}
        onEndReachedThreshold={0.4}
        refreshControl={refreshControl}
        contentContainerStyle={[
          { paddingTop: theme.spacing.md, paddingBottom: bottomPad },
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
