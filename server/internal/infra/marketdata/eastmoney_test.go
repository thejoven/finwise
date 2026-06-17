package marketdata

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEastMoneySecid(t *testing.T) {
	cases := map[string]string{
		"600519": "1.600519", // 沪 主板
		"688981": "1.688981", // 沪 科创板 (6 开头)
		"900901": "1.900901", // 沪 B股 (9 开头)
		"300750": "0.300750", // 深 创业板
		"002371": "0.002371", // 深 主板
		"830799": "0.830799", // 北交所 (8 开头)
		"430139": "0.430139", // 北交所 (4 开头)
	}
	for code, want := range cases {
		got, err := eastmoneySecid(code)
		if err != nil {
			t.Errorf("eastmoneySecid(%q) err: %v", code, err)
			continue
		}
		if got != want {
			t.Errorf("eastmoneySecid(%q) = %q, want %q", code, got, want)
		}
	}
	if _, err := eastmoneySecid("NVDA"); !errors.Is(err, ErrNotFound) {
		t.Errorf("non-6-digit should ErrNotFound, got %v", err)
	}
}

func TestEastMoneyDailyBars_parse(t *testing.T) {
	// 实测格式: klines CSV 字段序 = date,open,close,high,low,volume.
	const canned = `{"rc":0,"data":{"code":"300750","klines":[
		"2024-01-02,143.52,138.13,143.83,137.92,214033",
		"2024-01-03,137.40,137.10,138.58,135.70,197576"]}}`
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// 校验关键 query 透传
		if r.URL.Query().Get("secid") != "0.300750" {
			t.Errorf("secid = %q, want 0.300750", r.URL.Query().Get("secid"))
		}
		if r.URL.Query().Get("fqt") != "1" {
			t.Errorf("fqt = %q, want 1 (前复权)", r.URL.Query().Get("fqt"))
		}
		_, _ = w.Write([]byte(canned))
	}))
	defer srv.Close()

	em := NewEastMoneyWithBaseURL(srv.URL)
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC)
	bars, err := em.DailyBars(context.Background(), "a", "300750", from, to)
	if err != nil {
		t.Fatal(err)
	}
	if len(bars) != 2 {
		t.Fatalf("got %d bars, want 2", len(bars))
	}
	b := bars[0]
	if !b.Date.Equal(time.Date(2024, 1, 2, 0, 0, 0, 0, time.UTC)) {
		t.Errorf("date = %v", b.Date)
	}
	// open=143.52 close=138.13 high=143.83 low=137.92 vol=214033 (close 在 high 之前!)
	if b.Open != 143.52 || b.Close != 138.13 || b.High != 143.83 || b.Low != 137.92 || b.Volume != 214033 {
		t.Errorf("bar mismatch: %+v", b)
	}
}

func TestEastMoneyDailyBars_emptyAndUnsupported(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"rc":0,"data":null}`)) // 查无数据
	}))
	defer srv.Close()
	em := NewEastMoneyWithBaseURL(srv.URL)
	from := time.Date(2024, 1, 1, 0, 0, 0, 0, time.UTC)
	to := time.Date(2024, 1, 10, 0, 0, 0, 0, time.UTC)

	bars, err := em.DailyBars(context.Background(), "a", "000001", from, to)
	if err != nil || len(bars) != 0 {
		t.Errorf("data null → want empty/nil, got bars=%d err=%v", len(bars), err)
	}
	if _, err := em.DailyBars(context.Background(), "hk", "00700", from, to); !errors.Is(err, ErrUnsupported) {
		t.Errorf("hk should be ErrUnsupported, got %v", err)
	}
	if em.Supports("hk") || em.Supports("us") || !em.Supports("a") {
		t.Errorf("Supports: only a should be true")
	}
}
