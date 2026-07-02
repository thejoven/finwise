package marketdata

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestTencentSymbol(t *testing.T) {
	cases := map[string]string{
		"600519": "sh600519",
		"688981": "sh688981",
		"900901": "sh900901",
		"300750": "sz300750",
		"002371": "sz002371",
		"830799": "bj830799",
		"430139": "bj430139",
	}
	for code, want := range cases {
		got, err := tencentSymbol(code)
		if err != nil || got != want {
			t.Errorf("tencentSymbol(%q) = %q,%v want %q", code, got, err, want)
		}
	}
	if _, err := tencentSymbol("NVDA"); !errors.Is(err, ErrNotFound) {
		t.Errorf("non-6-digit should ErrNotFound, got %v", err)
	}
}

func TestTencentDailyBars_parse(t *testing.T) {
	// 实测格式: data.<symbol>.qfqday 行 = [date,open,close,high,low,volume,…] (字符串).
	const canned = `{"code":0,"msg":"","data":{"sz300750":{"qfqday":[
		["2026-06-03","437.000","426.420","437.000","420.100","385526.000"],
		["2026-06-04","426.420","408.200","426.900","407.180","431155.000"]]}}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := r.URL.Query().Get("param"); !strings.HasPrefix(p, "sz300750,day,") || !strings.HasSuffix(p, ",qfq") {
			t.Errorf("param = %q, want sz300750,day,...,qfq", p)
		}
		_, _ = w.Write([]byte(canned))
	}))
	defer srv.Close()

	tc := NewTencentWithBaseURL(srv.URL)
	from := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC)
	bars, err := tc.DailyBars(context.Background(), "a", "300750", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 2 {
		t.Fatalf("got %d bars, want 2", len(bars))
	}
	b := bars[0]
	// open=437 close=426.42 high=437 low=420.1 vol=385526 (close 在 high 之前!)
	if !b.Date.Equal(time.Date(2026, 6, 3, 0, 0, 0, 0, time.UTC)) ||
		b.Open != 437.0 || b.Close != 426.42 || b.High != 437.0 || b.Low != 420.1 || b.Volume != 385526 {
		t.Errorf("bar mismatch: %+v", b)
	}
}

func TestTencentDailyBars_emptyAndUnsupported(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":0,"data":[]}`)) // 无数据时 data 是空数组
	}))
	defer srv.Close()
	tc := NewTencentWithBaseURL(srv.URL)
	from := time.Date(2026, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC)

	bars, err := tc.DailyBars(context.Background(), "a", "000001", from, to)
	if err != nil || len(bars) != 0 {
		t.Errorf("empty data → want nil/empty, got bars=%d err=%v", len(bars), err)
	}
	// 未知市场 (非 a/hk/us) → ErrUnsupported.
	if _, err := tc.DailyBars(context.Background(), "crypto", "BTC", from, to); !errors.Is(err, ErrUnsupported) {
		t.Errorf("crypto should be ErrUnsupported for tencent, got %v", err)
	}
	// 美股各交易所后缀候选皆空 → 诚实返回空 (非错误).
	if b, err := tc.DailyBars(context.Background(), "us", "AAPL", from, to); err != nil || len(b) != 0 {
		t.Errorf("us empty → want nil/empty, got bars=%d err=%v", len(b), err)
	}
}

func TestTencentSymbols(t *testing.T) {
	cases := []struct {
		market, canonical string
		want              []string
	}{
		{"a", "300750", []string{"sz300750"}},
		{"hk", "0700", []string{"hk00700"}},               // 4 位补零到 5 位
		{"hk", "00700", []string{"hk00700"}},              // 已 5 位不变
		{"hk", "9992", []string{"hk09992"}},               // 泡泡玛特
		{"us", "AAPL", []string{"usAAPL.OQ", "usAAPL.N"}}, // 试两个交易所后缀
		{"us", "aapl", []string{"usAAPL.OQ", "usAAPL.N"}}, // 大写归一
	}
	for _, c := range cases {
		got, err := tencentSymbols(c.market, c.canonical)
		if err != nil {
			t.Errorf("tencentSymbols(%q,%q) err=%v", c.market, c.canonical, err)
			continue
		}
		if len(got) != len(c.want) {
			t.Errorf("tencentSymbols(%q,%q) = %v want %v", c.market, c.canonical, got, c.want)
			continue
		}
		for i := range got {
			if got[i] != c.want[i] {
				t.Errorf("tencentSymbols(%q,%q)[%d] = %q want %q", c.market, c.canonical, i, got[i], c.want[i])
			}
		}
	}
}

func TestTencentDailyBars_hk(t *testing.T) {
	// 港股: data.hk00700.day, 行尾多一个除权事件 dict (7 元素), 应被忽略; 列序同 A股 (close 在 high 前).
	const canned = `{"code":0,"msg":"","data":{"hk00700":{"day":[
		["2024-01-02","300.000","296.600","305.000","294.400","23354069.000",{"cqr":1}],
		["2024-01-03","297.000","300.000","301.000","295.000","20000000.000",{"cqr":1}]]}}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if p := r.URL.Query().Get("param"); !strings.HasPrefix(p, "hk00700,day,") {
			t.Errorf("param = %q, want hk00700,day,...", p)
		}
		_, _ = w.Write([]byte(canned))
	}))
	defer srv.Close()
	tc := NewTencentWithBaseURL(srv.URL)
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC)
	bars, err := tc.DailyBars(context.Background(), "hk", "0700", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 2 {
		t.Fatalf("got %d bars want 2", len(bars))
	}
	b := bars[0]
	if b.Open != 300.0 || b.Close != 296.6 || b.High != 305.0 || b.Low != 294.4 || b.Volume != 23354069 {
		t.Errorf("hk bar mismatch: %+v", b)
	}
}

func TestTencentDailyBars_usTryBoth(t *testing.T) {
	// 美股: .OQ (纳斯达克) 返空, 回落 .N (纽交所) 才有数据. 验证 try-both.
	const nyse = `{"code":0,"msg":"","data":{"usKO.N":{"day":[
		["2024-01-02","58.000","57.500","58.400","57.100","10000000.000"]]}}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Query().Get("param")
		switch {
		case strings.HasPrefix(p, "usKO.OQ,"):
			_, _ = w.Write([]byte(`{"code":0,"data":{"usKO.OQ":{"day":[]}}}`)) // 纳斯达克无此票
		case strings.HasPrefix(p, "usKO.N,"):
			_, _ = w.Write([]byte(nyse))
		default:
			t.Errorf("unexpected param %q", p)
			_, _ = w.Write([]byte(`{"code":0,"data":[]}`))
		}
	}))
	defer srv.Close()
	tc := NewTencentWithBaseURL(srv.URL)
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC)
	bars, err := tc.DailyBars(context.Background(), "us", "KO", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 1 {
		t.Fatalf("got %d bars want 1 (from .N after .OQ empty)", len(bars))
	}
	if bars[0].Open != 58.0 || bars[0].Close != 57.5 || bars[0].High != 58.4 || bars[0].Low != 57.1 {
		t.Errorf("us bar mismatch: %+v", bars[0])
	}
}

func TestTencentSupportsMarkets(t *testing.T) {
	tc := NewTencentWithBaseURL("http://x")
	for _, m := range []string{"a", "hk", "us"} {
		if !tc.Supports(m) {
			t.Errorf("Supports(%q) = false want true", m)
		}
	}
	if tc.Supports("crypto") || tc.Supports("fx") {
		t.Errorf("Supports crypto/fx should be false")
	}
}
