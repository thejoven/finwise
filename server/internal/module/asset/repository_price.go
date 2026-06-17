package asset

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"wiseflow/server/internal/infra/marketdata"
)

// ───────────────────────── 价格轮询 (poller) ─────────────────────────

// PriceTarget — 一个待同步行情的标的 (claim 出来给 poller).
//
//	AnchorAt = min(signal_assets.anchor_at) —— 回填起点 ("发现时刻"); 无关联信号则 nil.
//	LastDate = max(asset_prices.date)        —— 已有最新 bar; nil = 还没回填过.
type PriceTarget struct {
	ID          uuid.UUID
	Market      string
	Canonical   string
	PriceStatus string
	AnchorAt    *time.Time
	LastDate    *time.Time
}

// ClaimAssetsToPrice 认领一批到点该同步行情的标的 (CAS 置 price_checked_at=now, SKIP LOCKED).
// 只取 status=active (排除 untrackable) 且 price_status ∈ (pending,active) 且距上次检查 ≥ minInterval 的.
func (r *Repository) ClaimAssetsToPrice(ctx context.Context, limit int, minInterval time.Duration) ([]PriceTarget, error) {
	const q = `
		WITH due AS (
			SELECT a.id FROM assets a
			WHERE a.status = 'active'
			  AND a.price_status IN ('pending','active')
			  AND (a.price_checked_at IS NULL
			       OR a.price_checked_at < now() - make_interval(secs => $2))
			ORDER BY a.price_checked_at ASC NULLS FIRST
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		UPDATE assets a SET price_checked_at = now(), updated_at = now()
		FROM due WHERE a.id = due.id
		RETURNING a.id, a.market, a.canonical, a.price_status,
		          (SELECT min(sa.anchor_at) FROM signal_assets sa WHERE sa.asset_id = a.id),
		          (SELECT max(ap.date)      FROM asset_prices ap  WHERE ap.asset_id = a.id)
	`
	rows, err := r.pool.Query(ctx, q, limit, minInterval.Seconds())
	if err != nil {
		return nil, fmt.Errorf("claim assets to price: %w", err)
	}
	defer rows.Close()
	var out []PriceTarget
	for rows.Next() {
		var t PriceTarget
		if err := rows.Scan(&t.ID, &t.Market, &t.Canonical, &t.PriceStatus, &t.AnchorAt, &t.LastDate); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// InsertBars 批量 upsert 日线. 前复权数值会随后续分红除权变动, 故 ON CONFLICT DO UPDATE 刷新.
func (r *Repository) InsertBars(ctx context.Context, assetID uuid.UUID, bars []marketdata.Bar, source string) (int, error) {
	if len(bars) == 0 {
		return 0, nil
	}
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const q = `
		INSERT INTO asset_prices (asset_id, date, open, high, low, close, volume, source)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (asset_id, date) DO UPDATE SET
			open = EXCLUDED.open, high = EXCLUDED.high, low = EXCLUDED.low,
			close = EXCLUDED.close, volume = EXCLUDED.volume, source = EXCLUDED.source`
	n := 0
	for _, b := range bars {
		if _, err := tx.Exec(ctx, q,
			assetID, b.Date, b.Open, b.High, b.Low, b.Close, b.Volume, source,
		); err != nil {
			return 0, fmt.Errorf("insert bar %s %s: %w", assetID, b.Date.Format("2006-01-02"), err)
		}
		n++
	}
	return n, tx.Commit(ctx)
}

// MarkPriceSynced 同步成功: active + 记 synced_at, 清零失败计数.
func (r *Repository) MarkPriceSynced(ctx context.Context, assetID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE assets SET price_status='active', price_synced_at=now(), price_attempts=0, updated_at=now()
		WHERE id=$1`, assetID)
	return err
}

// MarkPriceUnsupported 该市场暂无 adapter (P1 的 hk/us): 标 unsupported, 不再被轮询认领.
func (r *Repository) MarkPriceUnsupported(ctx context.Context, assetID uuid.UUID) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE assets SET price_status='unsupported', updated_at=now() WHERE id=$1`, assetID)
	return err
}

// MarkPriceFailed 失败计数 +1; 达上限熔断为 failed (停轮询, 已缓存照常展示).
func (r *Repository) MarkPriceFailed(ctx context.Context, assetID uuid.UUID, maxAttempts int) error {
	_, err := r.pool.Exec(ctx, `
		UPDATE assets SET
			price_attempts = price_attempts + 1,
			price_status = CASE WHEN price_attempts + 1 >= $2 THEN 'failed' ELSE price_status END,
			updated_at = now()
		WHERE id=$1`, assetID, maxAttempts)
	return err
}

// ───────────────────────── 价格读 (handler) ─────────────────────────

// Price — 一根日线 (读出).
type Price struct {
	Date   time.Time
	Open   *float64
	High   *float64
	Low    *float64
	Close  float64
	Volume *int64
	Source string
}

// AssetPricesView — GET /v1/assets/:id/prices 回包: 标的 meta + 数据 as-of + 日线.
type AssetPricesView struct {
	Asset         Asset
	PriceStatus   string
	PriceSyncedAt *time.Time
	Bars          []Price
}

// PricesView 读标的 meta + [from,to] 日线 (升序). 标的不存在 → ErrNotFound.
// from/to 为零值时不加该侧边界.
func (r *Repository) PricesView(ctx context.Context, assetID uuid.UUID, from, to time.Time) (*AssetPricesView, error) {
	var v AssetPricesView
	const metaQ = `
		SELECT id, canonical, exchange, market, name, provider_symbol, type, status,
		       price_status, price_synced_at
		FROM assets WHERE id = $1`
	if err := r.pool.QueryRow(ctx, metaQ, assetID).Scan(
		&v.Asset.ID, &v.Asset.Canonical, &v.Asset.Exchange, &v.Asset.Market, &v.Asset.Name,
		&v.Asset.ProviderSymbol, &v.Asset.Type, &v.Asset.Status, &v.PriceStatus, &v.PriceSyncedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("prices view meta: %w", err)
	}

	const barsQ = `
		SELECT date, open, high, low, close, volume, source
		FROM asset_prices
		WHERE asset_id = $1
		  AND ($2::date IS NULL OR date >= $2)
		  AND ($3::date IS NULL OR date <= $3)
		ORDER BY date ASC`
	var fromArg, toArg *time.Time
	if !from.IsZero() {
		fromArg = &from
	}
	if !to.IsZero() {
		toArg = &to
	}
	rows, err := r.pool.Query(ctx, barsQ, assetID, fromArg, toArg)
	if err != nil {
		return nil, fmt.Errorf("prices view bars: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var p Price
		if err := rows.Scan(&p.Date, &p.Open, &p.High, &p.Low, &p.Close, &p.Volume, &p.Source); err != nil {
			return nil, err
		}
		v.Bars = append(v.Bars, p)
	}
	return &v, rows.Err()
}
