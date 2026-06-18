// Package attention 是注意力分析模块.
//
// 数据流: refinement.completed event → mastra attention-analyst → POST 回
// server (/v1/internal/attention) → 本模块写一条 attention_summaries 行.
// 用户拉 /v1/attention/summary 时本模块聚合返回.
package attention

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"alphax/server/internal/infra/db"
)

var ErrNotFound = errors.New("attention summary not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Summary 是一条 attention 记录.
type Summary struct {
	ID             uuid.UUID
	RefinementID   uuid.UUID
	UserID         uuid.UUID
	FocusScore     int
	DepthScore     int
	BreadthScore   int
	ExecutionScore int
	Insight        string
	Blindspot      string
	Model          string
	CreatedAt      time.Time
}

// UpsertInput — mastra 写回时用; 同 refinement_id 重消费会覆盖.
type UpsertInput struct {
	RefinementID   uuid.UUID
	UserID         uuid.UUID
	FocusScore     int
	DepthScore     int
	BreadthScore   int
	ExecutionScore int
	Insight        string
	Blindspot      string
	Model          string
}

func (r *Repository) Upsert(ctx context.Context, in UpsertInput) (*Summary, error) {
	const q = `
		INSERT INTO attention_summaries
			(refinement_id, user_id,
			 focus_score, depth_score, breadth_score, execution_score,
			 insight, blindspot, model)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		ON CONFLICT (refinement_id) DO UPDATE SET
			focus_score = EXCLUDED.focus_score,
			depth_score = EXCLUDED.depth_score,
			breadth_score = EXCLUDED.breadth_score,
			execution_score = EXCLUDED.execution_score,
			insight = EXCLUDED.insight,
			blindspot = EXCLUDED.blindspot,
			model = EXCLUDED.model,
			created_at = now()
		RETURNING id, created_at
	`
	var id uuid.UUID
	var createdAt time.Time
	err := r.pool.QueryRow(ctx, q,
		in.RefinementID, in.UserID,
		in.FocusScore, in.DepthScore, in.BreadthScore, in.ExecutionScore,
		in.Insight, in.Blindspot, in.Model,
	).Scan(&id, &createdAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) {
			return nil, fmt.Errorf("upsert attention (code=%s): %w", pgErr.Code, err)
		}
		return nil, fmt.Errorf("upsert attention: %w", err)
	}
	return &Summary{
		ID:             id,
		RefinementID:   in.RefinementID,
		UserID:         in.UserID,
		FocusScore:     in.FocusScore,
		DepthScore:     in.DepthScore,
		BreadthScore:   in.BreadthScore,
		ExecutionScore: in.ExecutionScore,
		Insight:        in.Insight,
		Blindspot:      in.Blindspot,
		Model:          in.Model,
		CreatedAt:      createdAt,
	}, nil
}

// ListByUser — 按 user 拉最近 N 条 (按 created_at desc), 用户拉统计页面用.
// projectID 非空时通过 EXISTS subquery 过滤到该分类下的 attention.
func (r *Repository) ListByUser(ctx context.Context, userID uuid.UUID, since *time.Time, projectID *uuid.UUID, limit int) ([]Summary, error) {
	if limit <= 0 {
		limit = 50
	}
	args := []any{userID}
	q := `
		SELECT id, refinement_id, user_id,
		       focus_score, depth_score, breadth_score, execution_score,
		       insight, blindspot, model, created_at
		FROM attention_summaries a
		WHERE a.user_id = $1
	`
	if since != nil {
		args = append(args, *since)
		q += fmt.Sprintf(" AND a.created_at >= $%d", len(args))
	}
	if projectID != nil {
		args = append(args, *projectID)
		q += fmt.Sprintf(`
			AND EXISTS (
				SELECT 1 FROM refinement_sessions rs
				JOIN signals s ON s.id = rs.primary_signal_id
				WHERE rs.id = a.refinement_id AND s.project_id = $%d
			)
		`, len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY a.created_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query attention list: %w", err)
	}
	defer rows.Close()

	out := make([]Summary, 0)
	for rows.Next() {
		var s Summary
		if err := rows.Scan(
			&s.ID, &s.RefinementID, &s.UserID,
			&s.FocusScore, &s.DepthScore, &s.BreadthScore, &s.ExecutionScore,
			&s.Insight, &s.Blindspot, &s.Model, &s.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan attention row: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// TagFreq — 拉用户已答 refinement 对应 signal 的 inference_tags 聚合 (top N).
// 走 join refinement_sessions → signals.inference_tags (text[]).
type TagFreq struct {
	Tag   string
	Count int
}

func (r *Repository) TopTagsByUser(ctx context.Context, userID uuid.UUID, since *time.Time, projectID *uuid.UUID, limit int) ([]TagFreq, error) {
	if limit <= 0 {
		limit = 10
	}
	args := []any{userID}
	q := `
		SELECT tag, COUNT(*) AS cnt
		FROM refinement_sessions rs
		JOIN signals s ON s.id = rs.primary_signal_id
		CROSS JOIN LATERAL unnest(COALESCE(s.inference_tags, ARRAY[]::text[])) AS tag
		WHERE rs.user_id = $1 AND rs.status = 'completed'
	`
	if since != nil {
		args = append(args, *since)
		q += fmt.Sprintf(" AND rs.completed_at >= $%d", len(args))
	}
	if projectID != nil {
		args = append(args, *projectID)
		q += fmt.Sprintf(" AND s.project_id = $%d", len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" GROUP BY tag ORDER BY cnt DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("query tag freq: %w", err)
	}
	defer rows.Close()

	out := make([]TagFreq, 0)
	for rows.Next() {
		var t TagFreq
		if err := rows.Scan(&t.Tag, &t.Count); err != nil {
			return nil, fmt.Errorf("scan tag row: %w", err)
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// CountCompletedRefinements — 该 user 在窗口内完成多少次五轮追问.
// projectID 非空时按 signals.project_id 过滤.
func (r *Repository) CountCompletedRefinements(ctx context.Context, userID uuid.UUID, since *time.Time, projectID *uuid.UUID) (int, error) {
	args := []any{userID}
	q := `
		SELECT count(*) FROM refinement_sessions rs
	`
	if projectID != nil {
		q += ` JOIN signals s ON s.id = rs.primary_signal_id `
	}
	q += ` WHERE rs.user_id = $1 AND rs.status = 'completed'`
	if since != nil {
		args = append(args, *since)
		q += fmt.Sprintf(" AND rs.completed_at >= $%d", len(args))
	}
	if projectID != nil {
		args = append(args, *projectID)
		q += fmt.Sprintf(" AND s.project_id = $%d", len(args))
	}
	var n int
	if err := r.pool.QueryRow(ctx, q, args...).Scan(&n); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return 0, nil
		}
		return 0, fmt.Errorf("count completed refinements: %w", err)
	}
	return n, nil
}
