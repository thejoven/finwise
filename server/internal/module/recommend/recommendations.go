package recommend

// recommendations.go —— P1「持仓相关情报」的数据层: recommendations 表的读写 (迁移 026).
// 这是 W1 落的地基; W2 的策展漏斗 (builder.go) 写入, 读端点 (GET /commitments/:id/related)
// 与反馈端点 (dismiss/seen) 消费它. 形态延续 subscription 的多态 (context_type+target_ref).

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
)

// ErrNotFound — 目标推荐不存在或不属于该 user (端点转 404).
var ErrNotFound = errors.New("recommend: not found")

// 来源类型 (source_type): v1 只有 tweet, 预留 telegram/rss.
const SourceTypeTweet = "tweet"

// 呈现位 (context_type). P1 只用 commitment.
const (
	ContextFeed       = "feed"
	ContextCommitment = "commitment"
	ContextArchive    = "archive"
	ContextDigest     = "digest"
)

// 状态机 (status).
const (
	StatusPending   = "pending"
	StatusSurfaced  = "surfaced"  // 已呈现给用户
	StatusDismissed = "dismissed" // 用户点"不相关" —— 负反馈, 回灌画像降权
	StatusPromoted  = "promoted"  // 用户真的转了信号 —— 强正反馈
	StatusExpired   = "expired"
)

func isValidContext(s string) bool {
	switch s {
	case ContextFeed, ContextCommitment, ContextArchive, ContextDigest:
		return true
	}
	return false
}

func isValidStatus(s string) bool {
	switch s {
	case StatusPending, StatusSurfaced, StatusDismissed, StatusPromoted, StatusExpired:
		return true
	}
	return false
}

// Recommendation — 一行 recommendations 的内存形态.
type Recommendation struct {
	ID          uuid.UUID
	UserID      uuid.UUID
	SourceType  string
	SourceID    string
	Score       float32
	Rationale   string
	ContextType string
	TargetRef   *uuid.UUID // commitment_id / evaluation_id; feed 为 nil
	Status      string
	Model       *string
	CreatedAt   time.Time
	SurfacedAt  *time.Time
	ActedAt     *time.Time
}

// UpsertRecommendation 幂等写入一条推荐 (同位 UNIQUE 冲突即更新分数/理由/模型).
// **冲突时不重置 status/时间戳** —— 已 dismissed 的不复活 (尊重负反馈), 已 surfaced 的不回退.
func (r *Repository) UpsertRecommendation(ctx context.Context, rec Recommendation) (uuid.UUID, error) {
	if !isValidContext(rec.ContextType) {
		return uuid.Nil, fmt.Errorf("recommend: invalid context_type %q", rec.ContextType)
	}
	sourceType := rec.SourceType
	if sourceType == "" {
		sourceType = SourceTypeTweet
	}
	const q = `
		INSERT INTO recommendations
			(user_id, source_type, source_id, score, rationale, context_type, target_ref, model)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		ON CONFLICT (user_id, source_id, context_type, target_ref) DO UPDATE SET
			score     = EXCLUDED.score,
			rationale = EXCLUDED.rationale,
			model     = EXCLUDED.model
		RETURNING id
	`
	var id uuid.UUID
	err := r.pool.QueryRow(ctx, q,
		rec.UserID, sourceType, rec.SourceID, rec.Score, rec.Rationale,
		rec.ContextType, rec.TargetRef, rec.Model).Scan(&id)
	if err != nil {
		return uuid.Nil, fmt.Errorf("upsert recommendation: %w", err)
	}
	return id, nil
}

const recommendationSelect = `
	SELECT id, user_id, source_type, source_id, score, rationale, context_type,
	       target_ref, status, model, created_at, surfaced_at, acted_at
	FROM recommendations
`

// ListRecommendations 取某呈现位下"未消解"(pending/surfaced) 的推荐, score 降序.
// targetRef 为 nil → 取该 context 下 target_ref IS NULL 的 (feed); 非 nil → 取该 target 的 (commitment).
func (r *Repository) ListRecommendations(ctx context.Context, userID uuid.UUID, contextType string, targetRef *uuid.UUID) ([]Recommendation, error) {
	if !isValidContext(contextType) {
		return nil, fmt.Errorf("recommend: invalid context_type %q", contextType)
	}
	q := recommendationSelect + `
		WHERE user_id = $1 AND context_type = $2
		  AND (($3::uuid IS NULL AND target_ref IS NULL) OR target_ref = $3)
		  AND status IN ('pending', 'surfaced')
		ORDER BY score DESC, created_at DESC
	`
	rows, err := r.pool.Query(ctx, q, userID, contextType, targetRef)
	if err != nil {
		return nil, fmt.Errorf("list recommendations: %w", err)
	}
	defer rows.Close()
	var out []Recommendation
	for rows.Next() {
		var rec Recommendation
		if err := rows.Scan(&rec.ID, &rec.UserID, &rec.SourceType, &rec.SourceID, &rec.Score,
			&rec.Rationale, &rec.ContextType, &rec.TargetRef, &rec.Status, &rec.Model,
			&rec.CreatedAt, &rec.SurfacedAt, &rec.ActedAt); err != nil {
			return nil, err
		}
		out = append(out, rec)
	}
	return out, rows.Err()
}

// MarkRecommendationStatus user-scoped 状态流转 (seen→surfaced / dismiss→dismissed / promote→promoted).
// surfaced 落 surfaced_at (首次); dismissed/promoted 落 acted_at. 不属于该 user → ErrNotFound.
func (r *Repository) MarkRecommendationStatus(ctx context.Context, userID, id uuid.UUID, status string) error {
	if !isValidStatus(status) {
		return fmt.Errorf("recommend: invalid status %q", status)
	}
	const q = `
		UPDATE recommendations SET
			status      = $3,
			surfaced_at = CASE WHEN $3 = 'surfaced' AND surfaced_at IS NULL THEN now() ELSE surfaced_at END,
			acted_at    = CASE WHEN $3 IN ('dismissed', 'promoted') THEN now() ELSE acted_at END
		WHERE id = $2 AND user_id = $1
	`
	tag, err := r.pool.Exec(ctx, q, userID, id, status)
	if err != nil {
		return fmt.Errorf("mark recommendation status: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}
