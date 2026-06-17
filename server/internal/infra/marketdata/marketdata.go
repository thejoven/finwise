// Package marketdata 是行情源抽象 (标的追踪 P1 · 规格 §3 硬问题二 / §5).
//
// 不同源 (东方财富 / 新浪 / 腾讯 / Tushare / AkShare) 各实现 Provider, 换源只改 adapter +
// 一个 env (MARKETDATA_PROVIDER), 把"选哪家"与"怎么用"解耦 —— 照 twtapi client /
// llm model 工厂 的可换源风格.
//
// 默认 tencent (腾讯 ifzq): 免费 / 国内可达不需翻墙 / 前复权 / 支持日期段查询.
// (东方财富 adapter 也在, 但 2026-06-16 实测它会在连续请求后封 205 的 IP —— 非官方源脆弱,
//
//	规格 §3 表已警示; 故默认改腾讯, 两者皆可经 MARKETDATA_PROVIDER 切换.)
//
// 已知代价: 非官方端点, 无 SLA, 上游可能变. 抽象层就是为了这一天能换源 (含将来上 Tushare 付费源).
package marketdata

import (
	"context"
	"errors"
	"strings"
	"time"
)

var (
	// ErrUnsupported — provider 不支持该 market (P1: eastmoney 只支持 A股).
	ErrUnsupported = errors.New("marketdata: market not supported by provider")
	// ErrNotFound — 源查不到该标的.
	ErrNotFound = errors.New("marketdata: symbol not found")
	// ErrRateLimited — 源限流, 调用方退避.
	ErrRateLimited = errors.New("marketdata: rate limited")
	// ErrUnavailable — 源暂时不可用 (网络 / 5xx / 超时), 已缓存数据照常展示.
	ErrUnavailable = errors.New("marketdata: source unavailable")
)

// Bar 是一根日线 (前复权). Date 为交易日 (UTC 零点).
type Bar struct {
	Date   time.Time
	Open   float64
	High   float64
	Low    float64
	Close  float64
	Volume int64
}

// Provider 是行情源抽象.
type Provider interface {
	// Name 是源标识, 落进 asset_prices.source (UI 标数据出处).
	Name() string
	// Supports 报告是否能取该 market (a|hk|us) 的行情.
	Supports(market string) bool
	// DailyBars 返回 [from, to] 区间日线 (前复权), 按日期升序; 无数据返回空切片 (非错误).
	DailyBars(ctx context.Context, market, canonical string, from, to time.Time) ([]Bar, error)
}

// New 按名字造 Provider. 空 / 未知名 → 回落默认 tencent. 加新源时在此扩 case.
func New(name string) Provider {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "", "tencent":
		return NewTencent()
	case "eastmoney":
		return NewEastMoney()
	default:
		return NewTencent()
	}
}
