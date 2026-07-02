package asset

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"alphax/server/internal/infra/mastra"
)

var (
	// ErrEmptyReference — 待归一的指称为空.
	ErrEmptyReference = errors.New("asset: empty reference")
	// ErrInvalidMarket — 人工指定的 market 不是 a|hk|us|crypto.
	ErrInvalidMarket = errors.New("asset: market must be a|hk|us|crypto")
	// ErrInvalidCode — 人工指定的 canonical 格式与 market 不符 (A=6位 / HK=数字 / US=ticker / crypto=大写ticker).
	ErrInvalidCode = errors.New("asset: canonical does not match market format")
	// ErrMissingFields — 非 untrackable 时缺 canonical / market.
	ErrMissingFields = errors.New("asset: canonical + market required unless untrackable")
)

// Service 编排归一: 别名/规则/LLM 归一 (resolveReference, 见 resolver.go)、存量回填 (Backfill)、
// 人工兜底 (ManualResolve). 资产是全局的 (非 per-user), 多信号共享一份 (§7 全局去重).
type Service struct {
	repo   *Repository
	mastra *mastra.Client
	logger *zap.Logger
}

func NewService(repo *Repository, mastraClient *mastra.Client, logger *zap.Logger) *Service {
	return &Service{repo: repo, mastra: mastraClient, logger: logger}
}

// ResolveReference 把一条自由文本指称归一到 asset_id (复用别名/规则/LLM 归一, 见 resolver.go).
// 供订阅模块把推文 AI 抽取的 ticker 落成 asset 用 (写 tweet_assets). 瞬时失败上抛, 调用方跳过.
func (s *Service) ResolveReference(ctx context.Context, reference, contextText string) (uuid.UUID, error) {
	id, _, err := s.resolveReference(ctx, reference, contextText)
	return id, err
}

// Prices 读标的 [from,to] 日线 + meta (GET /v1/assets/:id/prices). 标的不存在 → ErrNotFound.
// from/to 零值表示不设该侧边界.
func (s *Service) Prices(ctx context.Context, assetID uuid.UUID, from, to time.Time) (*AssetPricesView, error) {
	return s.repo.PricesView(ctx, assetID, from, to)
}

// ManualResolveInput — POST /v1/assets/resolve 的入参. 人工兜底: 手动指定规范代码, 或标 untrackable.
type ManualResolveInput struct {
	Reference   string     // 要纠正的自由文本指称 (必填)
	SignalID    *uuid.UUID // 可选: 同时把这条信号链到归一结果
	Untrackable bool       // true → 标不可追踪 (诚实留空), 忽略 canonical/market
	Canonical   string
	Exchange    string
	Market      string
	Name        string
}

// ManualResolve 人工归一: upsert assets/asset_aliases, 可选链接 signal_assets (冻结锚点).
// 校验失败返回 typed error (handler 映射 400).
func (s *Service) ManualResolve(ctx context.Context, in ManualResolveInput) (*Asset, error) {
	alias := normalizeAlias(in.Reference)
	if alias == "" {
		return nil, ErrEmptyReference
	}

	var res resolution
	if in.Untrackable {
		res = *untrackableRes(in.Reference, "人工标记不可追踪", "manual")
	} else {
		r, err := manualResolution(in.Market, in.Canonical, in.Exchange, in.Name)
		if err != nil {
			return nil, err
		}
		res = *r
	}

	id, err := s.repo.UpsertAsset(ctx, res)
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpsertAlias(ctx, alias, id); err != nil {
		return nil, err
	}
	if in.SignalID != nil {
		anchor, err := s.repo.SignalCapturedAt(ctx, *in.SignalID)
		if err != nil {
			return nil, err
		}
		if err := s.repo.LinkSignalAsset(ctx, *in.SignalID, id, "", anchor); err != nil {
			return nil, err
		}
	}
	return s.repo.GetAsset(ctx, id)
}

// manualResolution 校验 + 规范化人工指定的 {market, canonical}. 复用规则层的交易所/provider 推导.
func manualResolution(market, canonical, exchange, name string) (*resolution, error) {
	canonical = strings.TrimSpace(canonical)
	if canonical == "" {
		return nil, ErrMissingFields
	}
	var res *resolution
	switch strings.ToLower(strings.TrimSpace(market)) {
	case MarketA:
		if !reCodeA.MatchString(canonical) {
			return nil, ErrInvalidCode
		}
		res = aShare(canonical)
	case MarketHK:
		if !reCodeHK.MatchString(canonical) {
			return nil, ErrInvalidCode
		}
		res = hkShare(canonical)
	case MarketUS:
		c := strings.ToUpper(canonical)
		if !reCodeUS.MatchString(c) {
			return nil, ErrInvalidCode
		}
		res = &resolution{
			Canonical: c, Market: MarketUS, Name: c,
			ProviderSymbol: c, Type: "equity", Status: StatusActive,
		}
	case MarketCrypto:
		// 人工兜底允许强制任意 ticker (运营纠错), 只做结构校验, 不受白名单约束.
		c := strings.ToUpper(canonical)
		if !reCodeCrypto.MatchString(c) {
			return nil, ErrInvalidCode
		}
		res = cryptoRes(c, "manual")
	case "":
		return nil, ErrMissingFields
	default:
		return nil, ErrInvalidMarket
	}
	res.Source = "manual"
	if e := strings.ToUpper(strings.TrimSpace(exchange)); e != "" {
		res.Exchange = e
	}
	if n := strings.TrimSpace(name); n != "" {
		res.Name = n
	}
	return res, nil
}
