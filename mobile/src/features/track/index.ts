/**
 * 标的追踪 feature 的公共出口. 屏幕从 "@/features/track" 取组件/钩子, 不直接深引文件.
 */

export { PriceCurve, type CurveAnchor } from "./PriceCurve";
export { PriceCurveCard } from "./PriceCurveCard";
export { Sparkline } from "./Sparkline";
export { ChangeBadge } from "./ChangeBadge";
export { TrackAssetRow } from "./TrackAssetRow";
export { CompactTrackStrip } from "./CompactTrackStrip";
export { SignalTrackSection } from "./SignalTrackSection";
export { CommitmentTrackHero } from "./CommitmentTrackHero";

export {
  useSignalTrack,
  useCommitmentTrack,
  useAssetPrices,
  useAssetTheses,
  useTrackedAssets,
} from "./hooks";

export { useFavoriteAssets, useIsFavorite } from "./favorites";
export { useHiddenAssets, useIsHidden } from "./hidden";

export { changeColor, formatPct, formatClose, rangePct } from "./format";
