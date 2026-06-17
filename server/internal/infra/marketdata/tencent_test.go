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
	if _, err := tc.DailyBars(context.Background(), "us", "AAPL", from, to); !errors.Is(err, ErrUnsupported) {
		t.Errorf("us should be ErrUnsupported, got %v", err)
	}
}
