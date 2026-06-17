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

// Tencent — 腾讯财经 ifzq 日线 adapter (P1 默认 A股源).
//
// 选它而非东方财富: 实测 (2026-06-16, 205) 东方财富在连续请求后封了 205 的 IP (非官方源
// 脆弱, 规格 §3 表已警示); 腾讯同样免费 / 国内可达 / 前复权 / 支持日期段, 且当时未封.
// 两个 adapter 都留着, MARKETDATA_PROVIDER 可切 —— 抽象层就是为换源.
//
// 端点: GET /appstock/app/fqkline/get?param=<symbol>,day,<from>,<to>,<count>,qfq
//   - symbol: 沪 sh / 深 sz / 北 bj + 6 位代码.
//   - 返回 {code,data:{<symbol>:{qfqday:[[date,open,close,high,low,volume,…], …]}}} (前复权).
//   - 字段序同东方财富: date, open, **close**, high, low, volume.
type Tencent struct {
	baseURL string
	hc      *http.Client
}

const defaultTencentBase = "https://web.ifzq.gtimg.cn"

func NewTencent() *Tencent { return NewTencentWithBaseURL(defaultTencentBase) }

// NewTencentWithBaseURL 给测试 (httptest) 用.
func NewTencentWithBaseURL(baseURL string) *Tencent {
	return &Tencent{
		baseURL: strings.TrimRight(baseURL, "/"),
		hc:      &http.Client{Timeout: 15 * time.Second},
	}
}

func (t *Tencent) Name() string { return "tencent" }

// Supports — P1 只接 A股 (腾讯也能 hk/us, 但市场范围/交易日历差异留 P2+ 再接).
func (t *Tencent) Supports(market string) bool { return market == "a" }

func (t *Tencent) DailyBars(ctx context.Context, market, canonical string, from, to time.Time) ([]Bar, error) {
	if market != "a" {
		return nil, ErrUnsupported
	}
	symbol, err := tencentSymbol(canonical)
	if err != nil {
		return nil, err
	}
	// count 是返回上限 (腾讯实测 >2000 会 "param error"). 按日历天 + 余量估, clamp 到 [1,2000];
	// 腾讯只返 [from,to] 区间内的 bar, count 仅作上限, 故 P1 的近期锚点窗口绰绰有余.
	count := int(to.Sub(from).Hours()/24) + 5
	if count > 2000 {
		count = 2000
	}
	if count < 1 {
		count = 1
	}
	param := fmt.Sprintf("%s,day,%s,%s,%d,qfq",
		symbol, from.Format("2006-01-02"), to.Format("2006-01-02"), count)
	body, err := t.get(ctx, "/appstock/app/fqkline/get", url.Values{"param": {param}})
	if err != nil {
		return nil, err
	}
	return parseTencentKline(body, symbol)
}

// tencentSymbol 由 6 位 A股代码定前缀: 沪 (6/9)=sh, 北(4/8)=bj, 深(0/2/3)=sz.
func tencentSymbol(canonical string) (string, error) {
	if len(canonical) != 6 {
		return "", fmt.Errorf("%w: %q not a 6-digit A-share code", ErrNotFound, canonical)
	}
	switch canonical[0] {
	case '6', '9':
		return "sh" + canonical, nil
	case '4', '8':
		return "bj" + canonical, nil
	default:
		return "sz" + canonical, nil
	}
}

func (t *Tencent) get(ctx context.Context, path string, q url.Values) ([]byte, error) {
	u := t.baseURL + path + "?" + q.Encode()
	// 轻量重试: 非官方端点偶发连接重置 (EOF), 重试 1 次再判失败.
	var lastErr error
	for attempt := 0; attempt < 2; attempt++ {
		if attempt > 0 {
			select {
			case <-ctx.Done():
				return nil, ctx.Err()
			case <-time.After(600 * time.Millisecond):
			}
		}
		req, err := http.NewRequestWithContext(ctx, http.MethodGet, u, nil)
		if err != nil {
			return nil, err
		}
		req.Header.Set("User-Agent", "Mozilla/5.0 (wiseflow marketdata)")
		req.Header.Set("Referer", "https://gu.qq.com/")
		resp, err := t.hc.Do(req)
		if err != nil {
			lastErr = fmt.Errorf("%w: %v", ErrUnavailable, err)
			continue
		}
		body, rerr := io.ReadAll(io.LimitReader(resp.Body, 8<<20))
		resp.Body.Close()
		if rerr != nil {
			lastErr = fmt.Errorf("%w: read: %v", ErrUnavailable, rerr)
			continue
		}
		switch resp.StatusCode {
		case http.StatusOK:
			return body, nil
		case http.StatusTooManyRequests:
			return nil, ErrRateLimited
		default:
			lastErr = fmt.Errorf("%w: status %d", ErrUnavailable, resp.StatusCode)
		}
	}
	return nil, lastErr
}

type tencentResp struct {
	Data json.RawMessage `json:"data"`
}

// parseTencentKline 解析 data.<symbol>.qfqday (前复权日线). 无数据 → 空切片.
func parseTencentKline(body []byte, symbol string) ([]Bar, error) {
	var r tencentResp
	if err := json.Unmarshal(body, &r); err != nil {
		return nil, fmt.Errorf("%w: parse: %v", ErrUnavailable, err)
	}
	// data 可能是 {} 或 [] (无数据); 只在对象时解析.
	if len(r.Data) == 0 || r.Data[0] != '{' {
		return nil, nil
	}
	var m map[string]json.RawMessage
	if err := json.Unmarshal(r.Data, &m); err != nil {
		return nil, fmt.Errorf("%w: parse data: %v", ErrUnavailable, err)
	}
	raw, ok := m[symbol]
	if !ok {
		for _, v := range m { // 容错: key 大小写/格式偶有出入, 取唯一条目
			raw = v
			break
		}
	}
	if len(raw) == 0 {
		return nil, nil
	}
	var sd struct {
		QfqDay [][]interface{} `json:"qfqday"`
		Day    [][]interface{} `json:"day"`
	}
	if err := json.Unmarshal(raw, &sd); err != nil {
		return nil, fmt.Errorf("%w: parse symbol: %v", ErrUnavailable, err)
	}
	rows := sd.QfqDay
	if len(rows) == 0 {
		rows = sd.Day
	}
	bars := make([]Bar, 0, len(rows))
	for _, row := range rows {
		if len(row) < 6 {
			continue
		}
		d, err := time.Parse("2006-01-02", tcStr(row[0]))
		if err != nil {
			continue
		}
		bars = append(bars, Bar{
			Date:   d,
			Open:   tcFloat(row[1]),
			Close:  tcFloat(row[2]), // 注意: close 在 high 之前
			High:   tcFloat(row[3]),
			Low:    tcFloat(row[4]),
			Volume: int64(tcFloat(row[5])),
		})
	}
	return bars, nil
}

// 腾讯 qfqday 元素一般是字符串, 但偶有数字; 两种都吃.
func tcStr(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return fmt.Sprint(v)
}

func tcFloat(v interface{}) float64 {
	switch x := v.(type) {
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(x), 64)
		return f
	case float64:
		return x
	default:
		return 0
	}
}
