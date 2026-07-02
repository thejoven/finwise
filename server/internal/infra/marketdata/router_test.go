package marketdata

import (
	"context"
	"errors"
	"testing"
	"time"
)

// stubProvider — 测试用假源.
type stubProvider struct {
	name    string
	markets map[string]bool
	bars    []Bar
}

func (s stubProvider) Name() string           { return s.name }
func (s stubProvider) Supports(m string) bool { return s.markets[m] }
func (s stubProvider) DailyBars(_ context.Context, m, _ string, _, _ time.Time) ([]Bar, error) {
	if !s.markets[m] {
		return nil, ErrUnsupported
	}
	return s.bars, nil
}

func TestRouterDispatch(t *testing.T) {
	equity := stubProvider{name: "eq", markets: map[string]bool{"a": true, "hk": true, "us": true}, bars: []Bar{{Close: 1}}}
	crypto := stubProvider{name: "cr", markets: map[string]bool{"crypto": true}, bars: []Bar{{Close: 2}, {Close: 3}}}
	r := NewRouter(equity, crypto)

	// Supports 按腿分流.
	for _, m := range []string{"a", "hk", "us", "crypto"} {
		if !r.Supports(m) {
			t.Errorf("Supports(%q) = false, want true", m)
		}
	}
	if r.Supports("fx") {
		t.Errorf("Supports(fx) = true, want false")
	}

	// NameFor 给出真源名 (落库用), 而非 Router.Name().
	if r.NameFor("a") != "eq" || r.NameFor("crypto") != "cr" {
		t.Errorf("NameFor mismatch: a=%q crypto=%q", r.NameFor("a"), r.NameFor("crypto"))
	}
	if r.Name() != "router" {
		t.Errorf("Name() = %q want router", r.Name())
	}

	// DailyBars 命中对应腿.
	ctx := context.Background()
	if b, _ := r.DailyBars(ctx, "us", "AAPL", time.Time{}, time.Time{}); len(b) != 1 {
		t.Errorf("us bars = %d want 1 (equity leg)", len(b))
	}
	if b, _ := r.DailyBars(ctx, "crypto", "BTC", time.Time{}, time.Time{}); len(b) != 2 {
		t.Errorf("crypto bars = %d want 2 (crypto leg)", len(b))
	}
}

func TestRouterNilCryptoLeg(t *testing.T) {
	equity := stubProvider{name: "eq", markets: map[string]bool{"a": true}}
	r := NewRouter(equity, nil) // 未配 crypto 源

	if r.Supports("crypto") {
		t.Errorf("crypto Supports = true with nil crypto leg")
	}
	if _, err := r.DailyBars(context.Background(), "crypto", "BTC", time.Time{}, time.Time{}); !errors.Is(err, ErrUnsupported) {
		t.Errorf("crypto DailyBars err = %v want ErrUnsupported", err)
	}
	if r.NameFor("crypto") != "router" {
		t.Errorf("NameFor(crypto) with nil leg = %q want router", r.NameFor("crypto"))
	}
}
