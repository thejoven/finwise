/**
 * 标的专页 (P4) —— 点任意标的进来. 用户原话:"点击后查看对应发现后的股价变动".
 *
 * 上: 标的抬头 + 全程收盘曲线 (/assets/:id/prices) + 数据截至脚注.
 * 下: 反查档案 (/assets/:id/theses) —— 你碰过它的每条信号/承诺, 各算"发现至今"涨跌,
 *     点卡进对应信号/承诺页. 归档被否信号也在其中 ("你当时放下的, 后来怎么样了").
 *
 * 不可追踪标的: 显式"无法追踪此标的", **不画假线**; 档案照常列 (反查仍有价值).
 * 列表用 FlatList (抬头作 ListHeaderComponent) —— 命题数虽少, 但这是规范的列表渲染.
 */

import { FlatList, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useTranslation } from "react-i18next";

import {
  Display,
  DoubleRule,
  Icon,
  Mono,
  Sans,
  SectionHeader,
  Serif,
  TapEffect,
} from "@/shared/components";
import { theme, useThemeColors } from "@/core/theme";
import i18n from "@/core/i18n";
import { formatIsoDate, formatMonthDay } from "@/shared/format";
import type { AssetThesis, PriceBar, TrackAsset } from "@/core/api/track";
import {
  ChangeBadge,
  PriceCurve,
  changeColor,
  formatClose,
  rangePct,
  useAssetPrices,
  useAssetTheses,
  useFavoriteAssets,
  useIsFavorite,
} from "@/features/track";

const KNOWN_MARKETS = new Set(["a", "hk", "us", "other"]);

export default function AssetScreen() {
  const { t } = useTranslation();
  const { id } = useLocalSearchParams<{ id: string }>();
  const pricesQ = useAssetPrices(id);
  const thesesQ = useAssetTheses(id);

  const prices = pricesQ.data;
  const asset = prices?.asset ?? thesesQ.data?.asset ?? null;
  const bars = prices?.bars ?? [];
  const theses = thesesQ.data?.theses ?? [];

  const loading = pricesQ.isLoading && thesesQ.isLoading;
  const errored = pricesQ.isError && thesesQ.isError;

  return (
    <SafeAreaView style={styles.root} edges={["top", "bottom"]}>
      <Header title={asset?.canonical ?? ""} assetId={id} />
      <FlatTheses asset={asset} bars={bars} theses={theses} loading={loading} errored={errored} />
    </SafeAreaView>
  );
}

function FlatTheses({
  asset,
  bars,
  theses,
  loading,
  errored,
}: {
  asset: TrackAsset | null;
  bars: PriceBar[];
  theses: AssetThesis[];
  loading: boolean;
  errored: boolean;
}) {
  const { t } = useTranslation();

  return (
    <FlatList<AssetThesis>
      data={theses}
      keyExtractor={(th) => `${th.kind}-${th.commitment_id ?? th.signal_id}`}
      renderItem={({ item }) => <ThesisCard thesis={item} bars={bars} />}
      ListHeaderComponent={
        <AssetHeader asset={asset} bars={bars} loading={loading} errored={errored} />
      }
      ListEmptyComponent={
        loading || errored || !asset ? null : (
          <Serif size={13} italic style={styles.empty}>
            {t("track.asset.thesesEmpty")}
          </Serif>
        )
      }
      ItemSeparatorComponent={Separator}
      contentContainerStyle={styles.scroll}
    />
  );
}

const Separator = () => <View style={styles.sep} />;

function AssetHeader({
  asset,
  bars,
  loading,
  errored,
}: {
  asset: TrackAsset | null;
  bars: PriceBar[];
  loading: boolean;
  errored: boolean;
}) {
  const { t } = useTranslation();
  const c = useThemeColors();

  if (loading) {
    return (
      <Serif size={13} italic style={styles.muted}>
        {t("track.asset.loading")}
      </Serif>
    );
  }
  if (errored || !asset) {
    return (
      <Serif size={13} italic style={styles.error}>
        {t("track.asset.error")}
      </Serif>
    );
  }

  const marketLabel = KNOWN_MARKETS.has(asset.market)
    ? t(`track.market.${asset.market}` as "track.market.a")
    : asset.market;
  const metaBits = [asset.exchange, marketLabel].filter(Boolean).join(" · ");
  const trackable = asset.status !== "untrackable" && bars.length >= 2;
  const closes = bars.map((b) => b.close);
  const windowPct = rangePct(closes);

  return (
    <View style={styles.assetHead}>
      <Display size={26} style={styles.assetName}>
        {asset.name}
      </Display>
      <View style={styles.assetMetaRow}>
        <Mono size={12} style={styles.canonical}>
          {asset.canonical}
        </Mono>
        {metaBits ? (
          <Mono size={10} style={styles.assetMeta}>
            {metaBits}
          </Mono>
        ) : null}
        {asset.status === "delisted" ? (
          <Mono size={10} style={styles.delisted}>
            {t("track.asset.delisted")}
          </Mono>
        ) : null}
      </View>

      <DoubleRule />

      {trackable ? (
        <View style={styles.curveBlock}>
          <View style={styles.curveTop}>
            <Mono size={13} style={styles.latest}>
              {t("track.close.latest", { value: formatClose(closes[closes.length - 1]) })}
            </Mono>
            <ChangeBadge pct={windowPct} size={12} />
          </View>
          <PriceCurve
            bars={bars.map((b) => ({ date: b.date, close: b.close }))}
            color={changeColor(windowPct, c)}
            height={170}
          />
        </View>
      ) : (
        <View style={styles.untrackable}>
          <Serif size={14} italic style={styles.untrackableText}>
            {t("track.state.untrackable")}
          </Serif>
          <Serif size={12} italic style={styles.untrackableHint}>
            {t("track.state.untrackableHint")}
          </Serif>
        </View>
      )}

      <View style={styles.thesesHeader}>
        <SectionHeader label={t("track.asset.thesesLabel")} meta={t("track.asset.thesesMeta")} />
      </View>
    </View>
  );
}

/** 找日期 >= 锚点的第一根 bar 的收盘 → 到最新收盘的小数涨跌. 锚点早于数据 / 无数据 → null. */
function pctSinceAnchor(bars: PriceBar[], anchorIso: string): number | null {
  if (bars.length < 1) return null;
  const target = anchorIso.slice(0, 10);
  const anchorBar = bars.find((b) => b.date >= target);
  if (!anchorBar || anchorBar.close === 0) return null;
  const latest = bars[bars.length - 1]!.close;
  return (latest - anchorBar.close) / anchorBar.close;
}

function ThesisCard({ thesis, bars }: { thesis: AssetThesis; bars: PriceBar[] }) {
  const { t } = useTranslation();
  const isCommitment = thesis.kind === "commitment";
  const pct = pctSinceAnchor(bars, thesis.anchor_at);

  const onPress = () => {
    if (isCommitment && thesis.commitment_id) {
      router.push(`/commitment/${thesis.commitment_id}`);
    } else {
      router.push(`/signal/${thesis.signal_id}`);
    }
  };

  const statusLabel =
    isCommitment && thesis.commitment_status
      ? t(
          `track.asset.commitmentStatus.${thesis.commitment_status}` as "track.asset.commitmentStatus.signed",
        )
      : "";
  const actionLabel = thesis.action
    ? i18n.t(`commitment.action.${thesis.action}` as "commitment.action.buy")
    : "";

  return (
    <TapEffect style={styles.card} pressedStyle={styles.cardPressed} onPress={onPress}>
      <View style={styles.cardHead}>
        <View style={styles.kindRow}>
          <Sans
            size={9}
            weight="700"
            style={[styles.kindBadge, isCommitment ? styles.kindCommit : styles.kindSignal]}
          >
            {isCommitment ? t("track.asset.kind.commitment") : t("track.asset.kind.signal")}
          </Sans>
          <Mono size={10} style={styles.cardDate}>
            {t("track.asset.discoveredOn", { date: formatMonthDay(thesis.captured_at) })}
          </Mono>
        </View>
        <ChangeBadge pct={pct} size={12} />
      </View>

      {thesis.summary ? (
        <Serif size={14} style={styles.summary}>
          {thesis.summary}
        </Serif>
      ) : null}
      {thesis.rationale ? (
        <Serif size={12} style={styles.rationale}>
          {thesis.rationale}
        </Serif>
      ) : null}

      {isCommitment && (actionLabel || statusLabel) ? (
        <Mono size={10} style={styles.commitMeta}>
          {[actionLabel, statusLabel].filter(Boolean).join(" · ")}
          {thesis.signed_at
            ? ` · ${t("track.asset.signedOn", { date: formatIsoDate(thesis.signed_at) })}`
            : ""}
        </Mono>
      ) : null}

      <View style={styles.cardFoot}>
        <Mono size={9} style={styles.since}>
          {t("track.since.discovery")}
        </Mono>
        <Icon name="chevronRight" size={11} color={theme.color.muted} strokeWidth={1.5} />
      </View>
    </TapEffect>
  );
}

function Header({ title, assetId }: { title: string; assetId: string | undefined }) {
  const { t } = useTranslation();
  const starred = useIsFavorite(assetId ?? "");
  const toggle = useFavoriteAssets((s) => s.toggle);
  return (
    <View style={styles.header}>
      <TapEffect style={styles.backButton} onPress={() => router.back()} disableEffect>
        <Icon name="chevronLeft" size={18} color={theme.color.ink} strokeWidth={1.5} />
        <Serif size={13}>{t("track.asset.back")}</Serif>
      </TapEffect>
      <Mono size={12} style={styles.headerTitle} numberOfLines={1}>
        {title}
      </Mono>
      {assetId ? (
        <TapEffect
          style={styles.headerStar}
          hitSlop={8}
          disableEffect
          onPress={() => void toggle(assetId)}
        >
          <Icon
            name={starred ? "starFill" : "star"}
            size={20}
            color={starred ? theme.color.red : theme.color.muted}
            strokeWidth={1.5}
          />
        </TapEffect>
      ) : (
        <View style={styles.headerStar} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: theme.color.paper,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.color.rule,
    gap: theme.spacing.sm,
  },
  backButton: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    minWidth: 56,
  },
  headerTitle: {
    flex: 1,
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  headerStar: {
    width: 32,
    alignItems: "flex-end",
    justifyContent: "center",
  },
  scroll: {
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.lg,
    paddingBottom: theme.spacing.xxxl,
  },
  assetHead: {
    gap: theme.spacing.sm,
  },
  assetName: {
    color: theme.color.ink,
  },
  assetMetaRow: {
    flexDirection: "row",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: theme.spacing.sm,
  },
  canonical: {
    color: theme.color.ink2,
    letterSpacing: 1,
  },
  assetMeta: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
  delisted: {
    color: theme.color.red,
    letterSpacing: 0.5,
  },
  curveBlock: {
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  curveTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  latest: {
    color: theme.color.ink,
    letterSpacing: 0.5,
  },
  untrackable: {
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.md,
    gap: theme.spacing.xs,
    marginTop: theme.spacing.sm,
  },
  untrackableText: {
    color: theme.color.ink2,
  },
  untrackableHint: {
    color: theme.color.muted,
    lineHeight: 18,
  },
  thesesHeader: {
    marginTop: theme.spacing.lg,
  },
  sep: {
    height: theme.spacing.md,
  },
  card: {
    backgroundColor: theme.color.paper2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.rule,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    gap: theme.spacing.sm,
  },
  cardPressed: {
    backgroundColor: theme.color.paper3,
  },
  cardHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  kindRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing.sm,
  },
  kindBadge: {
    paddingHorizontal: 6,
    paddingVertical: 1,
    letterSpacing: 1,
    overflow: "hidden",
  },
  kindCommit: {
    color: theme.color.paper,
    backgroundColor: theme.color.ink,
  },
  kindSignal: {
    color: theme.color.ink2,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.color.muted,
  },
  cardDate: {
    color: theme.color.muted,
    letterSpacing: 1,
  },
  summary: {
    color: theme.color.ink,
    lineHeight: 21,
  },
  rationale: {
    color: theme.color.muted,
    lineHeight: 19,
  },
  commitMeta: {
    color: theme.color.muted,
    letterSpacing: 0.5,
  },
  cardFoot: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 2,
  },
  since: {
    color: theme.color.muted2,
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  muted: {
    color: theme.color.muted,
  },
  error: {
    color: theme.color.red,
  },
  empty: {
    color: theme.color.muted,
    paddingTop: theme.spacing.md,
  },
});
