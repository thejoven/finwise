package marketdata

import (
	"context"
	"time"
)

// Router 按 market 把行情请求分流到不同 Provider (标的追踪 多市场扩展).
//
// 原设计每个 Provider 是"一家源", 全局单选; 但 A/HK/US 走同一家 (腾讯/东财) 而 crypto
// 必须换一家源 (OKX/Binance) —— 单 Provider 装不下. Router 自身满足 Provider 接口
// (Name/Supports/DailyBars), 对 poller 是透明替换: poller 只调 Supports(market) + DailyBars,
// 不关心背后是一家还是几家.
//
//	equity — A股/港股/美股 (腾讯默认, 见 tencent.go / eastmoney.go)
//	crypto — 加密货币   (OKX 默认, 见 okx.go / binance.go)
//
// 换源哲学不变: equity 腿由 MARKETDATA_PROVIDER 选, crypto 腿由 CRYPTO_MARKETDATA_PROVIDER 选
// (见 marketdata.go 的 NewWithCrypto 工厂).
type Router struct {
	equity Provider
	crypto Provider
}

// NewRouter 组装分流器. 任一腿可为 nil (该市场即报不支持, 而非 panic).
func NewRouter(equity, crypto Provider) *Router {
	return &Router{equity: equity, crypto: crypto}
}

// pick 选出该 market 该走的 Provider (可能 nil).
func (r *Router) pick(market string) Provider {
	if market == MarketCrypto {
		return r.crypto
	}
	return r.equity
}

func (r *Router) Name() string { return "router" }

// NameFor 给出某 market 实际命中的源标识 (asset_prices.source 用: a/hk/us→tencent, crypto→okx).
// Router.Name() 恒为 "router" 不适合落库; poller 优先用本方法拿到真源名.
func (r *Router) NameFor(market string) string {
	if p := r.pick(market); p != nil {
		return p.Name()
	}
	return r.Name()
}

func (r *Router) Supports(market string) bool {
	p := r.pick(market)
	return p != nil && p.Supports(market)
}

func (r *Router) DailyBars(ctx context.Context, market, canonical string, from, to time.Time) ([]Bar, error) {
	p := r.pick(market)
	if p == nil || !p.Supports(market) {
		return nil, ErrUnsupported
	}
	return p.DailyBars(ctx, market, canonical, from, to)
}
