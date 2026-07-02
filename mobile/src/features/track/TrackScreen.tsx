/**
 * TrackScreen —— 「标的」底部 tab 的全屏宿主.
 *
 * 结构同财知 (CaizhiScreen): 固定报头 (TrackHeader 刊名「标的追踪」) + 吸顶分段栏
 *   (SegmentedTabs) + 原生 PagerView 三页, 左右滑动切换. 三页都是**同一份标的清单**的过滤视图:
 *     ① 所有标的 —— 你碰过的全部标的 (隐藏的除外). 星标置顶, 其余"有价在前".
 *     ② 收藏标的 —— 仅星标的标的 (隐藏的除外).
 *     ③ 已隐藏   —— 你主动隐藏的标的 (可一键恢复).
 *
 * 每行: 行首信息区 (canonical + 名称/市场 + 命题数) 下钻 /asset/[id] 专页, 右侧最新价 + 发现至今
 *   涨跌 (红涨绿跌; untrackable/未定价显示"无法追踪/暂无价", 一律不画假价); 行尾操作按钮 —— 在
 *   所有/收藏页是「星标 + 隐藏」, 在已隐藏页是「取消隐藏」.
 *
 * 星标 (useFavoriteAssets) 与隐藏 (useHiddenAssets) 都是本地持久化 store; **隐藏优先** ——
 *   隐藏的标的只在「已隐藏」出现, 不入所有/收藏.
 *
 * 数据: GET /v1/track/assets 取关联标的 (后端按 last_touched 倒序, 标的完整无缺); 信号/订阅
 *   不在本页 (各自在降噪页 / 订阅 tab). 报头/分段栏是 pager 的兄弟节点常驻顶部; 作为独立底部
 *   tab, 内层左右滑动不与外层冲突.
 *
 * @see CaizhiScreen — 同款宿主结构
 * @see SegmentedTabs
 */

import { useCallback, useMemo, useRef, type ReactNode } from "react";
import { ScrollView, StyleSheet, View, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSharedValue } from "react-native-reanimated";
import { router } from "expo-router";
import { useTranslation } from "react-i18next";
import PagerView, {
  type PagerViewOnPageScrollEventData,
  type PagerViewOnPageSelectedEventData,
} from "react-native-pager-view";

import {
  Icon,
  Mono,
  Sans,
  SegmentedTabs,
  Serif,
  TabMasthead,
  TAB_BAR_CLEARANCE,
  TapEffect,
} from "@/shared/components";
import { haptic } from "@/core/haptics";
import { theme } from "@/core/theme";
import type { TrackedAsset } from "@/core/api/track";

import { useTrackedAssets } from "./hooks";
import { ChangeBadge } from "./ChangeBadge";
import { formatClose } from "./format";
import { useFavoriteAssets, useIsFavorite } from "./favorites";
import { useHiddenAssets } from "./hidden";

const KNOWN_MARKETS = new Set(["a", "hk", "us", "crypto", "other"]);

/** 有最新价可展示 = 非 untrackable 且后端给了 latest_close. 决定行内画价还是"无法追踪/暂无价". */
function isPriced(a: TrackedAsset): boolean {
  return a.asset.status !== "untrackable" && a.latest_close != null;
}

/** 排序: 星标置顶 (你的关注), 其余"有价在前". 各组内保留后端 last_touched 序. */
function orderAssets(list: TrackedAsset[], favIds: Set<string>): TrackedAsset[] {
  const starred = list.filter((a) => favIds.has(a.asset.id));
  const rest = list.filter((a) => !favIds.has(a.asset.id));
  return [...starred, ...rest.filter(isPriced), ...rest.filter((a) => !isPriced(a))];
}

export default function TrackScreen() {
  const { t } = useTranslation();
  const pagerRef = useRef<PagerView>(null);
  const progress = useSharedValue(0);
  const { data, isLoading, isError } = useTrackedAssets();

  const tabs = useMemo(
    () => [t("track.tabs.all"), t("track.tabs.favorites"), t("track.tabs.hidden")],
    [t],
  );

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

  const assets = data ?? [];
  const favIds = useFavoriteAssets((s) => s.ids);
  const hiddenIds = useHiddenAssets((s) => s.ids);

  // 三态过滤 (隐藏优先: 隐藏的标的只进「已隐藏」, 不入所有/收藏).
  const { allList, favList, hiddenList } = useMemo(() => {
    const visible = assets.filter((a) => !hiddenIds.has(a.asset.id));
    return {
      allList: orderAssets(visible, favIds),
      favList: orderAssets(
        visible.filter((a) => favIds.has(a.asset.id)),
        favIds,
      ),
      hiddenList: assets.filter((a) => hiddenIds.has(a.asset.id)),
    };
  }, [assets, favIds, hiddenIds]);

  return (
    <View style={styles.root}>
      <TrackHeader />
      <SegmentedTabs tabs={tabs} progress={progress} onSelect={handleSelect} />
      <PagerView
        ref={pagerRef}
        style={styles.pager}
        initialPage={0}
        onPageScroll={onPageScroll}
        onPageSelected={onPageSelected}
      >
        <View key="all" style={styles.page} collapsable={false}>
          <Pane
            loading={isLoading}
            error={isError}
            empty={!allList.length}
            emptyText={t("track.empty.all")}
          >
            {allList.map((a) => (
              <AssetRow key={a.asset.id} item={a} />
            ))}
          </Pane>
        </View>
        <View key="favorites" style={styles.page} collapsable={false}>
          <Pane
            loading={isLoading}
            error={isError}
            empty={!favList.length}
            emptyText={t("track.empty.favorites")}
          >
            {favList.map((a) => (
              <AssetRow key={a.asset.id} item={a} />
            ))}
          </Pane>
        </View>
        <View key="hidden" style={styles.page} collapsable={false}>
          <Pane
            loading={isLoading}
            error={isError}
            empty={!hiddenList.length}
            emptyText={t("track.empty.hidden")}
          >
            {hiddenList.map((a) => (
              <AssetRow key={a.asset.id} item={a} hiddenTab />
            ))}
          </Pane>
        </View>
      </PagerView>
    </View>
  );
}

/** 标的页固定报头 —— 仅刊名「标的追踪」, 不带搜索/记录 (那是财知的录入动作). */
function TrackHeader() {
  const { t } = useTranslation();
  return <TabMasthead title={t("track.nameplate")} />;
}

/** 三页共用的滚动容器: loading / error / 本页为空各显一行居中状态, 否则列出 children.
 *  各页各自留底部空隙给悬浮 tab bar 让位 (insets.bottom + TAB_BAR_CLEARANCE). */
function Pane({
  loading,
  error,
  empty,
  emptyText,
  children,
}: {
  loading: boolean;
  error: boolean;
  empty: boolean;
  emptyText: string;
  children: ReactNode;
}) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const bottomPad = insets.bottom + TAB_BAR_CLEARANCE;

  return (
    <ScrollView
      style={styles.paneRoot}
      contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
      showsVerticalScrollIndicator={false}
    >
      {loading ? (
        <StatusLine text={t("track.loading")} />
      ) : error ? (
        <StatusLine text={t("track.error")} />
      ) : empty ? (
        <StatusLine text={emptyText} />
      ) : (
        <View style={styles.list}>{children}</View>
      )}
    </ScrollView>
  );
}

function StatusLine({ text }: { text: string }) {
  return (
    <Serif size={13} italic style={styles.status}>
      {text}
    </Serif>
  );
}

/**
 * 标的行 —— 行首信息区下钻专页 + 行尾操作 (兄弟而非嵌套, 互不抢手势; 操作 disableEffect 不连带高亮).
 *   hiddenTab: 在「已隐藏」页, 行尾是「取消隐藏」; 否则是「星标 + 隐藏」.
 */
function AssetRow({ item, hiddenTab = false }: { item: TrackedAsset; hiddenTab?: boolean }) {
  const { t } = useTranslation();
  const { asset } = item;
  const starred = useIsFavorite(asset.id);
  const toggleFav = useFavoriteAssets((s) => s.toggle);
  const toggleHidden = useHiddenAssets((s) => s.toggle);

  const marketLabel = KNOWN_MARKETS.has(asset.market)
    ? t(`track.market.${asset.market}` as "track.market.a")
    : asset.market;
  const sub = [asset.name, marketLabel].filter(Boolean).join(" · ");

  const untrackable = asset.status === "untrackable";
  const priced = isPriced(item);

  return (
    <View style={styles.row}>
      <TapEffect
        style={styles.rowMain}
        pressedStyle={styles.rowPressed}
        onPress={() => router.push(`/asset/${asset.id}`)}
      >
        <View style={styles.rowLeft}>
          <Mono size={13} style={styles.ticker}>
            {asset.canonical}
          </Mono>
          <Sans size={10} style={styles.sub} numberOfLines={1}>
            {sub}
          </Sans>
          <Mono size={9} style={styles.metaLine}>
            {t("track.thesisCount", { count: item.thesis_count })}
          </Mono>
        </View>

        {priced ? (
          <View style={styles.rowRight}>
            <Mono size={13} style={styles.close}>
              {formatClose(item.latest_close)}
            </Mono>
            <ChangeBadge pct={item.pct_since_discovery ?? null} size={12} />
            <Mono size={9} style={styles.since}>
              {t("track.since.discovery")}
            </Mono>
          </View>
        ) : (
          <Serif size={12} italic style={styles.untrackable}>
            {untrackable ? t("track.state.untrackable") : t("track.noPrice")}
          </Serif>
        )}
      </TapEffect>

      {hiddenTab ? (
        <TapEffect
          style={styles.action}
          hitSlop={8}
          disableEffect
          onPress={() => void toggleHidden(asset.id)}
          accessibilityRole="button"
          accessibilityLabel={t("track.unhide")}
        >
          <Icon name="eye" size={16} color={theme.color.muted} strokeWidth={1.5} />
        </TapEffect>
      ) : (
        <>
          <TapEffect
            style={styles.action}
            hitSlop={8}
            disableEffect
            onPress={() => void toggleFav(asset.id)}
            accessibilityRole="button"
            accessibilityLabel={starred ? t("track.unfavorite") : t("track.favorite")}
          >
            <Icon
              name={starred ? "starFill" : "star"}
              size={16}
              color={starred ? theme.color.red : theme.color.muted2}
              strokeWidth={1.5}
            />
          </TapEffect>
          <TapEffect
            style={styles.action}
            hitSlop={8}
            disableEffect
            onPress={() => void toggleHidden(asset.id)}
            accessibilityRole="button"
            accessibilityLabel={t("track.hide")}
          >
            <Icon name="eyeOff" size={16} color={theme.color.muted2} strokeWidth={1.5} />
          </TapEffect>
        </>
      )}
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

  // 页 / 列表
  paneRoot: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.md,
  },
  list: {
    marginTop: theme.spacing.xs,
  },
  status: {
    color: theme.color.muted,
    textAlign: "center",
    lineHeight: 22,
    paddingTop: theme.spacing.xxxl,
    paddingHorizontal: theme.spacing.lg,
  },

  // 标的行
  row: {
    flexDirection: "row",
    alignItems: "center",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.ruleSoft,
  },
  // 可点信息区 (下钻专页); 占满除行尾操作外的宽度. paddingVertical 在此 (撑起行高 + 触控区).
  rowMain: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  rowPressed: {
    backgroundColor: theme.color.paper3,
  },
  rowLeft: {
    flex: 1,
    gap: 2,
  },
  ticker: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  sub: {
    color: theme.color.muted,
  },
  metaLine: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  rowRight: {
    alignItems: "flex-end",
    gap: 2,
    minWidth: 72,
  },
  close: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  since: {
    color: theme.color.muted2,
    letterSpacing: 0.5,
  },
  untrackable: {
    color: theme.color.muted,
    flexShrink: 1,
    textAlign: "right",
  },
  // 行尾操作按钮 (星标 / 隐藏 / 取消隐藏) —— 与信息区同高, 与下钻互不抢手势.
  action: {
    paddingLeft: theme.spacing.sm,
    paddingVertical: theme.spacing.sm,
    alignItems: "center",
    justifyContent: "center",
  },
});
