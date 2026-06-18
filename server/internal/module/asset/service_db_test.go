package asset

import (
	"context"
	"errors"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"alphax/server/internal/infra/db"
)

// 集成测试: 跑真实 Postgres (需 migration 025 已应用). 无 DATABASE_URL 时跳过, 故
// `go test ./...` 在无库环境下照常全绿. 205 上 source .env 后跑, 验证人工兜底端点
// (ManualResolve) 的整条 service→repo→DB 路径 (HTTP handler 只是薄壳).
func testPool(t *testing.T) *db.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("no TEST_DATABASE_URL / DATABASE_URL — skipping asset DB integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("db open: %v", err)
	}
	return pool
}

func TestManualResolve_integration(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()

	// 清理本测试产生的 junk 别名 / untrackable 占位 (不动真实标的如 300750/NVDA).
	// 注意: 删除 + Close 都放进同一个 Cleanup 且 Close 在最后 —— 用 defer pool.Close()
	// 会先于 t.Cleanup 执行, 导致清理时 pool 已关.
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM asset_aliases WHERE alias_lower LIKE 'zz-test-%'`)
		_, _ = pool.Exec(ctx, `DELETE FROM assets WHERE market = 'other' AND canonical LIKE 'zz-test-%'`)
		pool.Close()
	})

	svc := NewService(NewRepository(pool), nil, zap.NewNop())
	uniq := "zz-test-" + uuid.NewString()[:8]

	t.Run("untrackable", func(t *testing.T) {
		a, err := svc.ManualResolve(ctx, ManualResolveInput{Reference: uniq + " 篮子", Untrackable: true})
		if err != nil {
			t.Fatal(err)
		}
		if a.Status != StatusUntrackable || a.Market != MarketOther {
			t.Errorf("got status=%s market=%s, want untrackable/other", a.Status, a.Market)
		}
	})

	t.Run("valid A-share then re-point alias", func(t *testing.T) {
		ref := uniq + " 宁德"
		a, err := svc.ManualResolve(ctx, ManualResolveInput{
			Reference: ref, Market: "a", Canonical: "300750", Name: "宁德时代",
		})
		if err != nil {
			t.Fatal(err)
		}
		if a.Market != MarketA || a.Canonical != "300750" || a.Exchange != "SZSE" || a.Status != StatusActive {
			t.Errorf("got %+v, want a/300750/SZSE/active", a)
		}
		// 同别名改指到另一标的 → UpsertAlias DO UPDATE 生效.
		a2, err := svc.ManualResolve(ctx, ManualResolveInput{Reference: ref, Market: "us", Canonical: "NVDA"})
		if err != nil {
			t.Fatal(err)
		}
		if a2.Market != MarketUS || a2.Canonical != "NVDA" {
			t.Errorf("re-point got %+v, want us/NVDA", a2)
		}
	})

	t.Run("invalid market rejected", func(t *testing.T) {
		_, err := svc.ManualResolve(ctx, ManualResolveInput{
			Reference: uniq + " kr", Market: "kr", Canonical: "005930",
		})
		if err != ErrInvalidMarket {
			t.Errorf("err = %v, want ErrInvalidMarket", err)
		}
	})
}

// TestPricesView_integration 验证 GET /v1/assets/:id/prices 的读路径 (PricesView) ——
// 依赖先跑过 cmd/asset-price-sync 落了行情; 无行情则跳过 (不依赖 P1 数据也能全绿).
func TestPricesView_integration(t *testing.T) {
	pool := testPool(t)
	ctx := context.Background()
	t.Cleanup(func() { pool.Close() })

	var id uuid.UUID
	err := pool.QueryRow(ctx,
		`SELECT asset_id FROM asset_prices GROUP BY asset_id ORDER BY count(*) DESC LIMIT 1`).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		t.Skip("no priced assets yet (run asset-price-sync first)")
	}
	if err != nil {
		t.Fatal(err)
	}

	svc := NewService(NewRepository(pool), nil, zap.NewNop())
	v, err := svc.Prices(ctx, id, time.Time{}, time.Time{})
	if err != nil {
		t.Fatal(err)
	}
	if len(v.Bars) == 0 {
		t.Fatal("priced asset returned no bars")
	}
	for i, b := range v.Bars {
		if b.Close <= 0 {
			t.Errorf("bar %d (%s) close=%v, want >0", i, b.Date.Format("2006-01-02"), b.Close)
		}
		if i > 0 && b.Date.Before(v.Bars[i-1].Date) {
			t.Errorf("bars not ascending at %d: %s before %s", i,
				b.Date.Format("2006-01-02"), v.Bars[i-1].Date.Format("2006-01-02"))
		}
	}
}
