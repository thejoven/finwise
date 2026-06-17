package asset

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
)

// 「发现后走势」读路径 (标的追踪 P2/P3). 承诺/信号 → 标的 → 冻结锚点 + 日线.
// 承诺侧复用既有链路反查 (§8 决策三: 不新建 commitment_assets 表):
//   commitments → gate_evaluations → refinement_sessions.primary_signal_id → signal_assets → assets.
// 这些跨表 (commitments/gate_evaluations/refinement_sessions) 只读 JOIN, 同 signal repo 读 projects 的先例.

// CommitmentMeta — 承诺的锚点附加信息 (签字日 + thesis 里的标的指称, 供 UI 兜底显示).
type CommitmentMeta struct {
	SignedAt    *time.Time
	ThesisAsset string
}

// AssetLink — 一条 信号↔标的 链接 + 冻结锚点 + 标的 meta.
type AssetLink struct {
	Asset    Asset
	Role     string
	AnchorAt time.Time
}

// GetCommitmentMeta — user-scoped; 承诺不存在/不属于该 user → ErrNotFound.
func (r *Repository) GetCommitmentMeta(ctx context.Context, userID, commitmentID uuid.UUID) (*CommitmentMeta, error) {
	const q = `SELECT signed_at, COALESCE(thesis->>'asset_ticker', '') FROM commitments WHERE id = $1 AND user_id = $2`
	var m CommitmentMeta
	if err := r.pool.QueryRow(ctx, q, commitmentID, userID).Scan(&m.SignedAt, &m.ThesisAsset); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get commitment meta: %w", err)
	}
	return &m, nil
}

const assetLinkSelect = `
	SELECT a.id, a.canonical, a.exchange, a.market, a.name, a.provider_symbol, a.type, a.status,
	       sa.role, sa.anchor_at
`

// CommitmentAssetLinks — 承诺 → (链路反查) → 标的 + 冻结锚点.
func (r *Repository) CommitmentAssetLinks(ctx context.Context, userID, commitmentID uuid.UUID) ([]AssetLink, error) {
	q := assetLinkSelect + `
		FROM commitments c
		JOIN gate_evaluations ge   ON ge.id = c.evaluation_id
		JOIN refinement_sessions rs ON rs.id = ge.refinement_id
		JOIN signal_assets sa       ON sa.signal_id = rs.primary_signal_id
		JOIN assets a               ON a.id = sa.asset_id
		WHERE c.id = $1 AND c.user_id = $2
		ORDER BY sa.role, a.canonical`
	return r.scanAssetLinks(ctx, q, commitmentID, userID)
}

// SignalAssetLinks — 信号 → 标的 + 冻结锚点 (user-scoped). 无链接返回空切片 (信号无相关标的).
func (r *Repository) SignalAssetLinks(ctx context.Context, userID, signalID uuid.UUID) ([]AssetLink, error) {
	q := assetLinkSelect + `
		FROM signal_assets sa
		JOIN signals s ON s.id = sa.signal_id
		JOIN assets a  ON a.id = sa.asset_id
		WHERE sa.signal_id = $1 AND s.user_id = $2
		ORDER BY sa.role, a.canonical`
	return r.scanAssetLinks(ctx, q, signalID, userID)
}

func (r *Repository) scanAssetLinks(ctx context.Context, q string, args ...any) ([]AssetLink, error) {
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query asset links: %w", err)
	}
	defer rows.Close()
	var out []AssetLink
	for rows.Next() {
		var l AssetLink
		if err := rows.Scan(
			&l.Asset.ID, &l.Asset.Canonical, &l.Asset.Exchange, &l.Asset.Market, &l.Asset.Name,
			&l.Asset.ProviderSymbol, &l.Asset.Type, &l.Asset.Status, &l.Role, &l.AnchorAt,
		); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// BarsForAssets — 一次取多个标的的全部日线 (升序), 按 asset_id 分组. 用于一批 track 拼装.
func (r *Repository) BarsForAssets(ctx context.Context, assetIDs []uuid.UUID) (map[uuid.UUID][]Price, error) {
	out := make(map[uuid.UUID][]Price)
	if len(assetIDs) == 0 {
		return out, nil
	}
	const q = `
		SELECT asset_id, date, open, high, low, close, volume, source
		FROM asset_prices
		WHERE asset_id = ANY($1)
		ORDER BY asset_id, date ASC`
	rows, err := r.pool.Query(ctx, q, assetIDs)
	if err != nil {
		return nil, fmt.Errorf("bars for assets: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var aid uuid.UUID
		var p Price
		if err := rows.Scan(&aid, &p.Date, &p.Open, &p.High, &p.Low, &p.Close, &p.Volume, &p.Source); err != nil {
			return nil, err
		}
		out[aid] = append(out[aid], p)
	}
	return out, rows.Err()
}
