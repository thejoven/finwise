package asset

import (
	"context"
	"time"

	"github.com/google/uuid"
)

// TrackBar — 走势曲线一个点 (收盘线足够画"发现后走势").
type TrackBar struct {
	Date  time.Time
	Close float64
}

// Track — 一只标的的"发现后表现": 锚定收益 + 收盘序列. 不可追踪标的 → Bars 空 + 各 close nil.
type Track struct {
	Asset             Asset
	Role              string
	AnchorAt          time.Time  // 发现时刻 (signal.captured_at, 冻结)
	AnchorClose       *float64   // 发现后首个交易日收盘
	SignedAt          *time.Time // 承诺签字日 (信号 track 为 nil)
	SignClose         *float64   // 签字后首个交易日收盘
	LatestClose       *float64
	LatestDate        *time.Time
	PctSinceDiscovery *float64 // (最新 − 发现日) / 发现日
	PctSinceSign      *float64 // (最新 − 签字日) / 签字日
	Source            string
	Bars              []TrackBar
}

// CommitmentTrackView — GET /v1/commitments/:id/track.
type CommitmentTrackView struct {
	CommitmentID uuid.UUID
	SignedAt     *time.Time
	ThesisAsset  string
	Tracks       []Track
}

// SignalTrackView — GET /v1/signals/:id/track.
type SignalTrackView struct {
	SignalID uuid.UUID
	Tracks   []Track
}

// CommitmentTrack — 承诺标的的发现后走势, 叠加签字日锚点 ("我这笔押对没"). 承诺不存在 → ErrNotFound.
func (s *Service) CommitmentTrack(ctx context.Context, userID, commitmentID uuid.UUID) (*CommitmentTrackView, error) {
	meta, err := s.repo.GetCommitmentMeta(ctx, userID, commitmentID)
	if err != nil {
		return nil, err
	}
	links, err := s.repo.CommitmentAssetLinks(ctx, userID, commitmentID)
	if err != nil {
		return nil, err
	}
	tracks, err := s.buildTracks(ctx, links, meta.SignedAt)
	if err != nil {
		return nil, err
	}
	return &CommitmentTrackView{
		CommitmentID: commitmentID, SignedAt: meta.SignedAt, ThesisAsset: meta.ThesisAsset, Tracks: tracks,
	}, nil
}

// SignalTrack — 信号标的的发现后走势 (无签字日锚点).
func (s *Service) SignalTrack(ctx context.Context, userID, signalID uuid.UUID) (*SignalTrackView, error) {
	links, err := s.repo.SignalAssetLinks(ctx, userID, signalID)
	if err != nil {
		return nil, err
	}
	tracks, err := s.buildTracks(ctx, links, nil)
	if err != nil {
		return nil, err
	}
	return &SignalTrackView{SignalID: signalID, Tracks: tracks}, nil
}

func (s *Service) buildTracks(ctx context.Context, links []AssetLink, signedAt *time.Time) ([]Track, error) {
	out := make([]Track, 0, len(links))
	if len(links) == 0 {
		return out, nil
	}
	ids := make([]uuid.UUID, 0, len(links))
	for _, l := range links {
		ids = append(ids, l.Asset.ID)
	}
	barsByAsset, err := s.repo.BarsForAssets(ctx, ids)
	if err != nil {
		return nil, err
	}
	for _, l := range links {
		out = append(out, buildTrack(l, signedAt, barsByAsset[l.Asset.ID]))
	}
	return out, nil
}

// buildTrack 算锚定收益: series 裁到 ≥ 发现日; anchor/sign close = 各自锚点日(含)起首个交易日收盘.
// 无价 (untrackable / 暂无数据) → Bars 空, 各 close 留 nil (诚实, UI 显示"无法追踪/暂无数据").
func buildTrack(l AssetLink, signedAt *time.Time, bars []Price) Track {
	t := Track{Asset: l.Asset, Role: l.Role, AnchorAt: l.AnchorAt, SignedAt: signedAt}
	for _, b := range bars {
		if dayBefore(b.Date, l.AnchorAt) {
			continue // 发现之前的 bar 不进序列
		}
		t.Bars = append(t.Bars, TrackBar{Date: b.Date, Close: b.Close})
		t.Source = b.Source
	}
	if len(t.Bars) == 0 {
		return t
	}
	ac := t.Bars[0].Close
	t.AnchorClose = &ac
	last := t.Bars[len(t.Bars)-1]
	lc, ld := last.Close, last.Date
	t.LatestClose, t.LatestDate = &lc, &ld
	if ac != 0 {
		p := lc/ac - 1
		t.PctSinceDiscovery = &p
	}
	if signedAt != nil {
		for _, b := range t.Bars {
			if !dayBefore(b.Date, *signedAt) {
				sc := b.Close
				t.SignClose = &sc
				if sc != 0 {
					p := lc/sc - 1
					t.PctSinceSign = &p
				}
				break
			}
		}
	}
	return t
}

// dayBefore — barDate (DATE, 当日零点) 是否早于 anchor 的日历日 (按 UTC 比较日期, 容忍 tz).
func dayBefore(barDate, anchor time.Time) bool {
	a := anchor.UTC()
	anchorDay := time.Date(a.Year(), a.Month(), a.Day(), 0, 0, 0, 0, time.UTC)
	return barDate.UTC().Before(anchorDay)
}

// AssetThesesView — GET /v1/assets/:id/theses (标的专页: 标的 meta + 我碰过它的全部命题).
type AssetThesesView struct {
	Asset  Asset
	Theses []Thesis
}

// AssetTheses — 标的不存在 → ErrNotFound; 存在但该 user 没碰过 → Theses 空 (标的全局).
func (s *Service) AssetTheses(ctx context.Context, userID, assetID uuid.UUID) (*AssetThesesView, error) {
	a, err := s.repo.GetAsset(ctx, assetID)
	if err != nil {
		return nil, err
	}
	theses, err := s.repo.AssetTheses(ctx, userID, assetID)
	if err != nil {
		return nil, err
	}
	return &AssetThesesView{Asset: *a, Theses: theses}, nil
}

// ───────────────────────── 标的追踪页 (§6.6) ─────────────────────────

// AssetCard — 标的追踪页「关联标的」卡.
type AssetCard struct {
	Asset             Asset
	PriceStatus       string
	PriceSyncedAt     *time.Time
	LastTouched       time.Time
	ThesisCount       int
	LatestClose       *float64
	LatestDate        *time.Time
	PctSinceDiscovery *float64
}

// trackedAssetsCap — 一次最多返回多少标的. 个人场景下等同"你全部在追的标的".
const trackedAssetsCap = 300

// TrackedAssetCards — 标的追踪页「关联标的」: 用户碰过的全部标的 (上限 trackedAssetsCap),
// 各带最新价 + 发现至今涨跌 + 命题数, 按 last_touched DESC. 信号/订阅不在此 (各有专门端点).
func (s *Service) TrackedAssetCards(ctx context.Context, userID uuid.UUID) ([]AssetCard, error) {
	tracked, err := s.repo.TrackedAssets(ctx, userID, trackedAssetsCap)
	if err != nil {
		return nil, err
	}
	cards := make([]AssetCard, 0, len(tracked))
	for _, t := range tracked {
		c := AssetCard{
			Asset: t.Asset, PriceStatus: t.PriceStatus, PriceSyncedAt: t.PriceSyncedAt,
			LastTouched: t.LastTouched, ThesisCount: t.ThesisCount,
			LatestClose: t.LatestClose, LatestDate: t.LatestDate,
		}
		if t.AnchorClose != nil && *t.AnchorClose != 0 && t.LatestClose != nil {
			p := (*t.LatestClose)/(*t.AnchorClose) - 1
			c.PctSinceDiscovery = &p
		}
		cards = append(cards, c)
	}
	return cards, nil
}
