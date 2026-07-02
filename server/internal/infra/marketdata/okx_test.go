package marketdata

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestOKXInstID(t *testing.T) {
	cases := map[string]string{"btc": "BTC-USDT", "ETH": "ETH-USDT", " sol ": "SOL-USDT"}
	for in, want := range cases {
		if got := okxInstID(in); got != want {
			t.Errorf("okxInstID(%q) = %q want %q", in, got, want)
		}
	}
}

func TestOKXDailyBars_parse(t *testing.T) {
	// 实测格式: data 行 = [ts_ms,open,high,low,close,vol,volCcy,volCcyQuote,confirm] (全字符串, 最新在前).
	// 首行 confirm=0 (今日未收盘) 应被丢弃; 其余按日期升序返回; 列序标准 OHLC (high 在 low 前).
	const canned = `{"code":"0","msg":"","data":[
		["1719792000000","104","112","103","105","10","1","1","0"],
		["1719705600000","95","106","94","100","9","1","1","1"],
		["1719619200000","90","98","88","95","8","1","1","1"]]}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasPrefix(r.URL.Path, "/api/v5/market/candles"):
			if r.URL.Query().Get("instId") != "BTC-USDT" || r.URL.Query().Get("bar") != "1Dutc" {
				t.Errorf("unexpected query %v", r.URL.RawQuery)
			}
			_, _ = w.Write([]byte(canned))
		default: // history-candles → 空, 防翻页
			_, _ = w.Write([]byte(`{"code":"0","msg":"","data":[]}`))
		}
	}))
	defer srv.Close()

	o := NewOKXWithBaseURL(srv.URL)
	from := time.Date(2024, 6, 29, 0, 0, 0, 0, time.UTC) // = 最老 bar, 令翻页在首页止
	to := time.Date(2024, 7, 2, 0, 0, 0, 0, time.UTC)
	bars, err := o.DailyBars(context.Background(), MarketCrypto, "BTC", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 2 {
		t.Fatalf("got %d bars, want 2 (today's confirm=0 dropped)", len(bars))
	}
	// 升序: 第一根 = 2024-06-29 open90 high98 low88 close95
	b := bars[0]
	if !b.Date.Equal(time.Date(2024, 6, 29, 0, 0, 0, 0, time.UTC)) ||
		b.Open != 90 || b.High != 98 || b.Low != 88 || b.Close != 95 || b.Volume != 8 {
		t.Errorf("bars[0] = %+v", b)
	}
	if !bars[1].Date.After(bars[0].Date) {
		t.Errorf("bars not ascending: %v then %v", bars[0].Date, bars[1].Date)
	}
}

func TestOKXDailyBars_unknownInstrument(t *testing.T) {
	// 未知/退市交易对 (code 51001) → 诚实返回空, 非错误 (poller 不该无限重试).
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"code":"51001","msg":"Instrument ID does not exist","data":[]}`))
	}))
	defer srv.Close()

	o := NewOKXWithBaseURL(srv.URL)
	from := time.Date(2024, 6, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 7, 1, 0, 0, 0, 0, time.UTC)
	bars, err := o.DailyBars(context.Background(), MarketCrypto, "FOOBARCOIN", from, to)
	if err != nil {
		t.Fatalf("unknown instrument should be empty not error, got %v", err)
	}
	if len(bars) != 0 {
		t.Fatalf("got %d bars, want 0", len(bars))
	}
}

func TestOKXSupports(t *testing.T) {
	o := NewOKXWithBaseURL("http://x")
	if !o.Supports(MarketCrypto) || o.Supports(MarketA) || o.Supports(MarketUS) {
		t.Errorf("OKX.Supports wrong: crypto only")
	}
}
