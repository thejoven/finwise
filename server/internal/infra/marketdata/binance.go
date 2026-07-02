package marketdata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"
)

// Binance — 加密货币日线 adapter (crypto 备选源, CRYPTO_MARKETDATA_PROVIDER=binance).
//
// 仅在 205 有代理出口时可用: api.binance.com 在国内被墙; 数据只读镜像 data-api.binance.vision
// 可达性未知, 需实测. 默认源仍是 OKX (见 okx.go).
//
// 端点: GET /api/v3/klines?symbol=BTCUSDT&interval=1d&startTime=<ms>&endTime=<ms>&limit=1000
// 行格式 (数组, **最老在前**): [openTime, open, high, low, close, volume, closeTime, ...] (共 12 列).
//   - openTime 为数字(ms); OHLCV 为字符串. close 在 idx 4 (标准 OHLC 序).
//   - limit 上限 1000 (≈ 2.7 年日线), 覆盖本项目锚点窗口足够, 暂不翻页.
type Binance struct {
	baseURL string
	hc      *http.Client
}

const defaultBinanceBase = "https://data-api.binance.vision"

// NewBinance 造 Binance adapter. 主域名可经 BINANCE_BASE_URL 覆盖.
func NewBinance() *Binance {
	base := strings.TrimSpace(os.Getenv("BINANCE_BASE_URL"))
	if base == "" {
		base = defaultBinanceBase
	}
	return NewBinanceWithBaseURL(base)
}

// NewBinanceWithBaseURL 给测试 (httptest) / 显式覆盖用.
func NewBinanceWithBaseURL(baseURL string) *Binance {
	return &Binance{
		baseURL: strings.TrimRight(baseURL, "/"),
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

func (b *Binance) Name() string { return "binance" }

func (b *Binance) Supports(market string) bool { return market == MarketCrypto }

// binanceSymbol 由规范代码 (BTC) 拼交易对 (BTCUSDT, 无连字符). 报价对锚 USDT.
func binanceSymbol(canonical string) string {
	return strings.ToUpper(strings.TrimSpace(canonical)) + "USDT"
}

func (b *Binance) DailyBars(ctx context.Context, market, canonical string, from, to time.Time) ([]Bar, error) {
	if market != MarketCrypto {
		return nil, ErrUnsupported
	}
	q := url.Values{
		"symbol":    {binanceSymbol(canonical)},
		"interval":  {"1d"},
		"startTime": {strconv.FormatInt(from.UnixMilli(), 10)},
		"endTime":   {strconv.FormatInt(to.UnixMilli(), 10)},
		"limit":     {"1000"},
	}
	u := b.baseURL + "/api/v3/klines?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (alphax marketdata)")
	resp, err := b.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, 16<<20))
	if rerr != nil {
		return nil, fmt.Errorf("%w: read: %v", ErrUnavailable, rerr)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		// fallthrough
	case http.StatusTooManyRequests, http.StatusTeapot: // 418 = IP banned for rate abuse
		return nil, ErrRateLimited
	case http.StatusBadRequest:
		// 无效交易对 → 诚实返回空 (非可重试失败)
		return nil, nil
	default:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	return parseBinanceKline(body)
}

// parseBinanceKline 解析 klines 数组 (最老在前). 畸形行跳过. 空 → 空切片.
func parseBinanceKline(body []byte) ([]Bar, error) {
	var rows [][]json.RawMessage
	if err := json.Unmarshal(body, &rows); err != nil {
		return nil, fmt.Errorf("%w: parse: %v", ErrUnavailable, err)
	}
	bars := make([]Bar, 0, len(rows))
	for _, r := range rows {
		if len(r) < 6 {
			continue
		}
		var openTime int64
		if err := json.Unmarshal(r[0], &openTime); err != nil {
			continue
		}
		d := time.UnixMilli(openTime).UTC()
		bars = append(bars, Bar{
			Date:   time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC),
			Open:   atof(jsonStr(r[1])),
			High:   atof(jsonStr(r[2])),
			Low:    atof(jsonStr(r[3])),
			Close:  atof(jsonStr(r[4])),
			Volume: int64(atof(jsonStr(r[5]))),
		})
	}
	return bars, nil
}

// jsonStr 剥掉 JSON 字符串两端引号 (Binance OHLCV 是带引号字符串). 非字符串原样返回.
func jsonStr(raw json.RawMessage) string {
	var s string
	if err := json.Unmarshal(raw, &s); err == nil {
		return s
	}
	return string(raw)
}
