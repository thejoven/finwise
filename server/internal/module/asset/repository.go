package asset

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/infra/db"
)

// ErrNotFound — asset / signal 不存在.
var ErrNotFound = errors.New("asset: not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Asset — 注册表行 (读出, 给 handler / 诊断用).
type Asset struct {
	ID             uuid.UUID
	Canonical      string
	Exchange       string
	Market         string
	Name           string
	ProviderSymbol *string
	Type           string
	Status         string
}

// SignalAssetsRow — backfill 输入: 一条信号 + 它的自由文本标的数组.
type SignalAssetsRow struct {
	ID         uuid.UUID
	CapturedAt time.Time
	Assets     []domain.RelatedAsset
}

// LookupAlias 别名缓存 → asset_id. 未命中返回 (Nil, false, nil).
func (r *Repository) LookupAlias(ctx context.Context, aliasLower string) (uuid.UUID, bool, error) {
	var id uuid.UUID
	err := r.pool.QueryRow(ctx,
		`SELECT asset_id FROM asset_aliases WHERE alias_lower = $1`, aliasLower).Scan(&id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return uuid.Nil, false, nil
		}
		return uuid.Nil, false, fmt.Errorf("lookup alias: %w", err)
	}
	return id, true, nil
}

// UpsertAsset 按 (market, canonical) 幂等; 命中刷新可变字段, 返回 id.
// status 只升不降: untrackable → active 允许 (人工/规则修正), 反向不动 —— 别让后续噪声
// 把已认定的标的降级回 untrackable.
func (r *Repository) UpsertAsset(ctx context.Context, res resolution) (uuid.UUID, error) {
	const q = `
		INSERT INTO assets (canonical, exchange, market, name, provider_symbol, type, status)
		VALUES ($1, $2, $3, $4, NULLIF($5, ''), $6, $7)
		ON CONFLICT (market, canonical) DO UPDATE SET
			name            = EXCLUDED.name,
			exchange        = EXCLUDED.exchange,
			provider_symbol = COALESCE(EXCLUDED.provider_symbol, assets.provider_symbol),
			type            = EXCLUDED.type,
			status          = CASE WHEN assets.status = 'untrackable'
			                       THEN EXCLUDED.status ELSE assets.status END,
			updated_at      = now()
		RETURNING id`
	var id uuid.UUID
	if err := r.pool.QueryRow(ctx, q,
		res.Canonical, res.Exchange, res.Market, res.Name, res.ProviderSymbol, res.Type, res.Status,
	).Scan(&id); err != nil {
		return uuid.Nil, fmt.Errorf("upsert asset: %w", err)
	}
	return id, nil
}

// UpsertAlias 记 alias_lower → asset_id. 冲突时改指 (人工兜底可纠正一个错误归一).
func (r *Repository) UpsertAlias(ctx context.Context, aliasLower string, assetID uuid.UUID) error {
	const q = `
		INSERT INTO asset_aliases (alias_lower, asset_id) VALUES ($1, $2)
		ON CONFLICT (alias_lower) DO UPDATE SET asset_id = EXCLUDED.asset_id`
	if _, err := r.pool.Exec(ctx, q, aliasLower, assetID); err != nil {
		return fmt.Errorf("upsert alias: %w", err)
	}
	return nil
}

// LinkSignalAsset 写 signal_assets (role=beneficiary). anchor_at 冻结, ON CONFLICT DO NOTHING
// 保证重跑不覆盖既有锚点 (§7 锚点冻结).
func (r *Repository) LinkSignalAsset(ctx context.Context, signalID, assetID uuid.UUID, rationale string, anchorAt time.Time) error {
	const q = `
		INSERT INTO signal_assets (signal_id, asset_id, role, anchor_at, rationale)
		VALUES ($1, $2, 'beneficiary', $3, NULLIF($4, ''))
		ON CONFLICT (signal_id, asset_id) DO NOTHING`
	if _, err := r.pool.Exec(ctx, q, signalID, assetID, anchorAt, rationale); err != nil {
		return fmt.Errorf("link signal asset: %w", err)
	}
	return nil
}

// SignalsWithAssets 拉所有"降噪后有相关标的"的信号 (backfill 输入).
func (r *Repository) SignalsWithAssets(ctx context.Context) ([]SignalAssetsRow, error) {
	const q = `
		SELECT id, captured_at, inference_related_assets
		FROM signals
		WHERE jsonb_typeof(inference_related_assets) = 'array'
		  AND jsonb_array_length(inference_related_assets) > 0
		ORDER BY captured_at ASC`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("query signals with assets: %w", err)
	}
	defer rows.Close()
	var out []SignalAssetsRow
	for rows.Next() {
		var row SignalAssetsRow
		var raw []byte
		if err := rows.Scan(&row.ID, &row.CapturedAt, &raw); err != nil {
			return nil, err
		}
		if len(raw) > 0 {
			if err := json.Unmarshal(raw, &row.Assets); err != nil {
				return nil, fmt.Errorf("unmarshal related_assets for %s: %w", row.ID, err)
			}
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GetAsset 按 id 读 (handler 回包).
func (r *Repository) GetAsset(ctx context.Context, id uuid.UUID) (*Asset, error) {
	const q = `
		SELECT id, canonical, exchange, market, name, provider_symbol, type, status
		FROM assets WHERE id = $1`
	var a Asset
	if err := r.pool.QueryRow(ctx, q, id).Scan(
		&a.ID, &a.Canonical, &a.Exchange, &a.Market, &a.Name, &a.ProviderSymbol, &a.Type, &a.Status,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get asset: %w", err)
	}
	return &a, nil
}

// SignalCapturedAt 取信号的 captured_at, 作人工归一链接 signal_assets 的冻结锚点.
func (r *Repository) SignalCapturedAt(ctx context.Context, signalID uuid.UUID) (time.Time, error) {
	var t time.Time
	if err := r.pool.QueryRow(ctx,
		`SELECT captured_at FROM signals WHERE id = $1`, signalID).Scan(&t); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return time.Time{}, ErrNotFound
		}
		return time.Time{}, fmt.Errorf("signal captured_at: %w", err)
	}
	return t, nil
}
