package asset

import (
	"math"
	"testing"
	"time"
)

// approxEq —— 容差比较: Go 常量折叠 (高精度) 与运行时 float64 计算可差 1 ULP.
func approxEq(a, b float64) bool { return math.Abs(a-b) < 1e-9 }

func mkPrices(t *testing.T, rows [][2]interface{}) []Price {
	t.Helper()
	var bs []Price
	for _, r := range rows {
		dt, err := time.Parse("2006-01-02", r[0].(string))
		if err != nil {
			t.Fatal(err)
		}
		bs = append(bs, Price{Date: dt, Close: r[1].(float64), Source: "tencent"})
	}
	return bs
}

func TestBuildTrack(t *testing.T) {
	anchor := time.Date(2026, 5, 25, 9, 0, 0, 0, time.UTC) // 发现时刻 (带时分)
	link := AssetLink{
		Asset:    Asset{Canonical: "002371", Market: MarketA, Status: StatusActive, Name: "北方华创"},
		Role:     "beneficiary",
		AnchorAt: anchor,
	}
	bars := mkPrices(t, [][2]interface{}{
		{"2026-05-22", 700.0}, // 发现前 → 应被裁掉
		{"2026-05-25", 698.19},
		{"2026-05-26", 690.0},
		{"2026-06-16", 672.19},
	})

	t.Run("discovery anchor + trim + pct", func(t *testing.T) {
		tr := buildTrack(link, nil, bars)
		if len(tr.Bars) != 3 {
			t.Fatalf("bars=%d, want 3 (05-22 应裁掉)", len(tr.Bars))
		}
		if tr.AnchorClose == nil || *tr.AnchorClose != 698.19 {
			t.Errorf("anchor_close=%v, want 698.19", tr.AnchorClose)
		}
		if tr.LatestClose == nil || *tr.LatestClose != 672.19 {
			t.Errorf("latest_close=%v, want 672.19", tr.LatestClose)
		}
		if want := 672.19/698.19 - 1; tr.PctSinceDiscovery == nil || !approxEq(*tr.PctSinceDiscovery, want) {
			t.Errorf("pct_since_discovery=%v, want %v", tr.PctSinceDiscovery, want)
		}
		if tr.SignedAt != nil || tr.SignClose != nil || tr.PctSinceSign != nil {
			t.Errorf("信号 track 不应有签字日字段: %+v", tr)
		}
	})

	t.Run("sign anchor", func(t *testing.T) {
		signed := time.Date(2026, 5, 26, 0, 0, 0, 0, time.UTC)
		tr := buildTrack(link, &signed, bars)
		if tr.SignClose == nil || *tr.SignClose != 690.0 {
			t.Errorf("sign_close=%v, want 690 (签字日首个交易日)", tr.SignClose)
		}
		if want := 672.19/690.0 - 1; tr.PctSinceSign == nil || !approxEq(*tr.PctSinceSign, want) {
			t.Errorf("pct_since_sign=%v, want %v", tr.PctSinceSign, want)
		}
	})

	t.Run("untrackable / no bars → nil closes (诚实)", func(t *testing.T) {
		tr := buildTrack(link, nil, nil)
		if len(tr.Bars) != 0 || tr.AnchorClose != nil || tr.LatestClose != nil || tr.PctSinceDiscovery != nil {
			t.Errorf("无 bar 应得空 track: %+v", tr)
		}
		if tr.Asset.Canonical != "002371" || tr.AnchorAt != anchor {
			t.Errorf("meta 仍应保留: %+v", tr)
		}
	})
}
