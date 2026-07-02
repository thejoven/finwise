package marketdata

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"sort"
	"strconv"
	"strings"
	"time"
)

// OKX — 加密货币日线 adapter (标的追踪 多市场扩展 · 默认 crypto 源).
//
// 选 OKX: Chinese-origin 交易所, 提供真实 OHLC+成交量, instId 形如 BTC-USDT.
// 报价对锚 USDT (≈1 USD), 落库按"美元计价"呈现 (稳定币偏离仅在脱锚事件, 可接受).
//
// 端点:
//   - GET /api/v5/market/candles?instId=BTC-USDT&bar=1Dutc&limit=300      (最近, 上限 300)
//   - GET /api/v5/market/history-candles?instId=...&bar=1Dutc&after=<ms>&limit=100 (更早, 向后翻页)
//
// 行格式 (全字符串, **最新在前**): [ts_ms, open, high, low, close, vol, volCcy, volCcyQuote, confirm]
//   - 列序是标准 OHLC (high 在 low 前) —— 与国内源 (close 在 high 前) **不同**, 勿套用腾讯映射.
//   - confirm=="0" = 今日未收盘 bar, 丢弃 (否则污染今日 OHLC 与锚定收益).
//   - 加密 7×24 无交易日历, 每日一根 (含周末); 落库前反转为按日期升序.
//
// 已知风险: www.okx.com 疑被 GFW 墙 —— 205 上若不可达, 设 OKX_BASE_URL=https://aws.okx.com.
type OKX struct {
	baseURL string
	hc      *http.Client
}

const defaultOKXBase = "https://www.okx.com"

// NewOKX 造 OKX adapter. 主域名可经 OKX_BASE_URL 覆盖 (205 被墙时切 aws.okx.com), 空则默认.
func NewOKX() *OKX {
	base := strings.TrimSpace(os.Getenv("OKX_BASE_URL"))
	if base == "" {
		base = defaultOKXBase
	}
	return NewOKXWithBaseURL(base)
}

// NewOKXWithBaseURL 给测试 (httptest) / 显式覆盖用.
func NewOKXWithBaseURL(baseURL string) *OKX {
	return &OKX{
		baseURL: strings.TrimRight(baseURL, "/"),
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

func (o *OKX) Name() string { return "okx" }

func (o *OKX) Supports(market string) bool { return market == MarketCrypto }

// errOKXNoInstrument — OKX 报该 instId 不存在 (code 51001): 当作"无数据"而非可重试失败.
var errOKXNoInstrument = errors.New("okx: instrument does not exist")

// okxInstID 由规范代码 (BTC) 拼出交易对 instId (BTC-USDT). 报价对锚 USDT.
func okxInstID(canonical string) string {
	return strings.ToUpper(strings.TrimSpace(canonical)) + "-USDT"
}

const (
	okxPageCap      = 40                     // 翻页上限 (backstop; 100 根/页 × 40 ≈ 11 年)
	okxPageSpacing  = 200 * time.Millisecond // 翻页间隔 (OKX history-candles 限 20 次/2s)
	okxRecentLimit  = "300"
	okxHistoryLimit = "100"
)

func (o *OKX) DailyBars(ctx context.Context, market, canonical string, from, to time.Time) ([]Bar, error) {
	if market != MarketCrypto {
		return nil, ErrUnsupported
	}
	inst := okxInstID(canonical)
	fromDay := time.Date(from.UTC().Year(), from.UTC().Month(), from.UTC().Day(), 0, 0, 0, 0, time.UTC)
	fromMs := fromDay.UnixMilli()
	toMs := to.UnixMilli()

	seen := make(map[int64]bool)
	var all []Bar
	cursor := "" // "" = 首页取最近; 否则 after=<最老ts> 向后翻页

	for page := 0; page < okxPageCap; page++ {
		var path string
		q := url.Values{"instId": {inst}, "bar": {"1Dutc"}}
		if cursor == "" {
			path = "/api/v5/market/candles"
			q.Set("limit", okxRecentLimit)
		} else {
			path = "/api/v5/market/history-candles"
			q.Set("limit", okxHistoryLimit)
			q.Set("after", cursor)
		}
		rows, err := o.getCandles(ctx, path, q)
		if err != nil {
			if errors.Is(err, errOKXNoInstrument) {
				break // 未知/退市交易对 → 诚实返回空
			}
			return nil, err
		}
		if len(rows) == 0 {
			break
		}
		oldestMs := int64(1) << 62
		added := 0
		for _, r := range rows {
			b, ts, ok := parseOKXRow(r)
			if !ok {
				continue // 丢弃未收盘 / 畸形行
			}
			if ts < oldestMs {
				oldestMs = ts
			}
			if seen[ts] || ts < fromMs || ts > toMs {
				continue
			}
			seen[ts] = true
			all = append(all, b)
			added++
		}
		if oldestMs <= fromMs || added == 0 && cursor != "" {
			break // 已翻到窗口起点, 或历史页无新增
		}
		cursor = strconv.FormatInt(oldestMs, 10)
		select {
		case <-ctx.Done():
			return nil, ctx.Err()
		case <-time.After(okxPageSpacing):
		}
	}

	sort.Slice(all, func(i, j int) bool { return all[i].Date.Before(all[j].Date) })
	return all, nil
}

// parseOKXRow 解析一行 candle. confirm=="0" (未收盘) / 畸形 → ok=false.
// 返回 ts(ms) 供翻页游标推进. 列序标准 OHLC: [ts,open,high,low,close,vol,...,confirm].
func parseOKXRow(r []string) (Bar, int64, bool) {
	if len(r) < 6 {
		return Bar{}, 0, false
	}
	if len(r) >= 9 && strings.TrimSpace(r[8]) == "0" {
		return Bar{}, 0, false // 今日未收盘
	}
	tsMs, err := strconv.ParseInt(strings.TrimSpace(r[0]), 10, 64)
	if err != nil {
		return Bar{}, 0, false
	}
	d := time.UnixMilli(tsMs).UTC()
	return Bar{
		Date:   time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, time.UTC),
		Open:   atof(r[1]),
		High:   atof(r[2]),
		Low:    atof(r[3]),
		Close:  atof(r[4]),
		Volume: int64(atof(r[5])),
	}, tsMs, true
}

type okxResp struct {
	Code string     `json:"code"`
	Msg  string     `json:"msg"`
	Data [][]string `json:"data"`
}

// getCandles 拉一页并解析出行数组. code!="0" → 映射错误 (51001=无此交易对).
func (o *OKX) getCandles(ctx context.Context, path string, q url.Values) ([][]string, error) {
	u := o.baseURL + path + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "Mozilla/5.0 (alphax marketdata)")
	resp, err := o.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, rerr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if rerr != nil {
		return nil, fmt.Errorf("%w: read: %v", ErrUnavailable, rerr)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		// fallthrough to body parse
	case http.StatusTooManyRequests:
		return nil, ErrRateLimited
	default:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
	var r okxResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("%w: parse: %v", ErrUnavailable, err)
	}
	if r.Code != "0" {
		switch r.Code {
		case "51001": // Instrument ID does not exist
			return nil, errOKXNoInstrument
		case "50011", "50061": // Too Many Requests / rate limited
			return nil, ErrRateLimited
		default:
			return nil, fmt.Errorf("%w: okx code %s %s", ErrUnavailable, r.Code, r.Msg)
		}
	}
	return r.Data, nil
}
