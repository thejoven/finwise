package marketdata

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// EastMoney — 东方财富 push2his 日线 adapter (P1 默认 A股源).
//
// 实测 (2026-06-16, 205): GET /api/qt/stock/kline/get?secid=<m.code>&klt=101&fqt=1
//
//	&fields2=f51,f52,f53,f54,f55,f56&beg=YYYYMMDD&end=YYYYMMDD
//
// 返回 {rc,data:{code,klines:["date,open,close,high,low,volume", …]}} (前复权日线).
//   - secid: market 前缀 1=沪 (6/9 开头) / 0=深(0/2/3)·北(4/8); code 为 6 位.
//   - klt=101 日线; fqt=1 前复权 (收益锚一致性需要); beg/end 闭区间.
//   - klines CSV 字段序: date, open, **close**, high, low, volume (close 在 high 之前, 别错位).
type EastMoney struct {
	baseURL string
	hc      *http.Client
}

const defaultEastMoneyBase = "https://push2his.eastmoney.com"

func NewEastMoney() *EastMoney { return NewEastMoneyWithBaseURL(defaultEastMoneyBase) }

// NewEastMoneyWithBaseURL 给测试 (httptest) 用.
func NewEastMoneyWithBaseURL(baseURL string) *EastMoney {
	return &EastMoney{
		baseURL: strings.TrimRight(baseURL, "/"),
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

func (e *EastMoney) Name() string { return "eastmoney" }

func (e *EastMoney) Supports(market string) bool { return market == "a" }

func (e *EastMoney) DailyBars(ctx context.Context, market, canonical string, from, to time.Time) ([]Bar, error) {
	if market != "a" {
		return nil, ErrUnsupported
	}
	secid, err := eastmoneySecid(canonical)
	if err != nil {
		return nil, err
	}
	q := url.Values{
		"secid":   {secid},
		"klt":     {"101"}, // 日线
		"fqt":     {"1"},   // 前复权
		"fields1": {"f1"},
		"fields2": {"f51,f52,f53,f54,f55,f56"}, // date,open,close,high,low,volume
		"beg":     {from.Format("20060102")},
		"end":     {to.Format("20060102")},
		"lmt":     {"100000"},
	}
	body, err := e.get(ctx, "/api/qt/stock/kline/get", q)
	if err != nil {
		return nil, err
	}
	return parseEastMoneyKline(body)
}

// eastmoneySecid 由 6 位 A股代码定 secid: 沪 (6/9 开头)=1, 深(0/2/3)·北(4/8)=0.
func eastmoneySecid(canonical string) (string, error) {
	if len(canonical) != 6 {
		return "", fmt.Errorf("%w: %q not a 6-digit A-share code", ErrNotFound, canonical)
	}
	switch canonical[0] {
	case '6', '9':
		return "1." + canonical, nil
	default: // 0/2/3 深 · 4/8 北
		return "0." + canonical, nil
	}
}

func (e *EastMoney) get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	u := e.baseURL + path + "?" + q.Encode()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
	if err != nil {
		return nil, err
	}
	// 非官方端点对 UA 不挑, 但带一个常规 UA 更稳.
	req.Header.Set("User-Agent", "Mozilla/5.0 (alphax marketdata)")

	resp, err := e.hc.Do(req)
	if err != nil {
		return nil, fmt.Errorf("%w: %v", ErrUnavailable, err)
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
	if err != nil {
		return nil, fmt.Errorf("%w: read: %v", ErrUnavailable, err)
	}
	switch resp.StatusCode {
	case http.StatusOK:
		return body, nil
	case http.StatusTooManyRequests:
		return nil, ErrRateLimited
	default:
		return nil, fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
	}
}

type eastmoneyResp struct {
	Data *struct {
		Code   string   `json:"code"`
		Klines []string `json:"klines"`
	} `json:"data"`
}

// parseEastMoneyKline 解析 klines CSV. data 为 null (查无此标的 / 区间无数据) → 空切片.
func parseEastMoneyKline(body []byte) ([]Bar, error) {
	var r eastmoneyResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("%w: parse: %v", ErrUnavailable, err)
	}
	if r.Data == nil || len(r.Data.Klines) == 0 {
		return nil, nil
	}
	bars := make([]Bar, 0, len(r.Data.Klines))
	for _, line := range r.Data.Klines {
		f := strings.Split(line, ",")
		if len(f) < 6 {
			continue // 跳过畸形行, 不让一行坏数据毁整批
		}
		d, err := time.Parse("2006-01-02", f[0])
		if err != nil {
			continue
		}
		bars = append(bars, Bar{
			Date:   d,
			Open:   atof(f[1]),
			Close:  atof(f[2]), // 注意: close 在 high 之前
			High:   atof(f[3]),
			Low:    atof(f[4]),
			Volume: atoi(f[5]),
		})
	}
	return bars, nil
}

func atof(s string) float64 {
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return v
}

func atoi(s string) int64 {
	// volume 可能是浮点串 ("232120" 或 "232120.000"), 先 float 再截断.
	v, _ := strconv.ParseFloat(strings.TrimSpace(s), 64)
	return int64(v)
}
