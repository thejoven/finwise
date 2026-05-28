// Package research stores Mastra 在 Analyst / Socratic 流程里检索得到的"学习材料".
//
// 设计:
//   - 不走 events 表 — 检索结果是辅助 grounding, 丢了 mastra 重检索就行.
//   - 一张 signal_research 表, scope 区分 'signal' / 'refinement_round'.
//   - 由 mastra 通过 /v1/internal/research 写入 (internal token), mobile 通过
//     /v1/refinement/sessions/:id/research 读 (dev bearer + user_id 校验).
package research

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"flashfi/server/internal/infra/db"
)

var (
	ErrInvalidInput = errors.New("research: invalid input")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Scope 枚举.
type Scope string

const (
	ScopeSignal           Scope = "signal"
	ScopeRefinementRound  Scope = "refinement_round"
)

// Result 是 Brave/Tavily/... 返回的单条搜索条目, 对客户端透明.
type Result struct {
	Title       string `json:"title"`
	URL         string `json:"url"`
	Description string `json:"description"`
	Age         string `json:"age,omitempty"`
	Domain      string `json:"domain,omitempty"`
}

// Record 是表里一行 (含 metadata, 对外暴露).
type Record struct {
	ID           uuid.UUID  `json:"id"`
	UserID       uuid.UUID  `json:"user_id"`
	Scope        Scope      `json:"scope"`
	SignalID     *uuid.UUID `json:"signal_id,omitempty"`
	RefinementID *uuid.UUID `json:"refinement_id,omitempty"`
	Round        *int       `json:"round,omitempty"`
	Query        string     `json:"query"`
	Results      []Result   `json:"results"`
	Model        string     `json:"model"`
	CreatedAt    time.Time  `json:"created_at"`
}

// ───── Save ─────

type SaveInput struct {
	UserID       uuid.UUID
	Scope        Scope
	SignalID     *uuid.UUID
	RefinementID *uuid.UUID
	Round        *int
	Query        string
	Results      []Result
	Model        string
}

func (r *Repository) Save(ctx context.Context, in SaveInput) (*Record, error) {
	if err := validateSave(in); err != nil {
		return nil, err
	}

	resultsJSON, err := json.Marshal(in.Results)
	if err != nil {
		return nil, fmt.Errorf("marshal results: %w", err)
	}

	id := uuid.New()
	now := time.Now().UTC()

	const insert = `
		INSERT INTO signal_research
			(id, user_id, scope, signal_id, refinement_id, round, query, results, model, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
	`
	if _, err := r.pool.Exec(ctx, insert,
		id, in.UserID, string(in.Scope), in.SignalID, in.RefinementID, in.Round,
		in.Query, resultsJSON, in.Model, now,
	); err != nil {
		return nil, fmt.Errorf("insert research: %w", err)
	}

	return &Record{
		ID:           id,
		UserID:       in.UserID,
		Scope:        in.Scope,
		SignalID:     in.SignalID,
		RefinementID: in.RefinementID,
		Round:        in.Round,
		Query:        in.Query,
		Results:      in.Results,
		Model:        in.Model,
		CreatedAt:    now,
	}, nil
}

func validateSave(in SaveInput) error {
	if in.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if in.Query == "" {
		return fmt.Errorf("%w: query required", ErrInvalidInput)
	}
	if in.Model == "" {
		return fmt.Errorf("%w: model required", ErrInvalidInput)
	}
	switch in.Scope {
	case ScopeSignal:
		if in.SignalID == nil {
			return fmt.Errorf("%w: signal scope requires signal_id", ErrInvalidInput)
		}
		if in.RefinementID != nil || in.Round != nil {
			return fmt.Errorf("%w: signal scope must not set refinement_id/round", ErrInvalidInput)
		}
	case ScopeRefinementRound:
		if in.RefinementID == nil {
			return fmt.Errorf("%w: refinement_round scope requires refinement_id", ErrInvalidInput)
		}
		if in.Round == nil || *in.Round < 1 || *in.Round > 5 {
			return fmt.Errorf("%w: refinement_round requires round in [1,5]", ErrInvalidInput)
		}
	default:
		return fmt.Errorf("%w: unknown scope %q", ErrInvalidInput, in.Scope)
	}
	return nil
}

// ───── Read ─────

// ListBySession 拉一个 refinement session 全部研究: signal-scope 那条 + 各 round 的定向检索.
// 按 (scope, round, created_at) 排, 让"学习卡片" / "每题来源" 渲染顺序天然.
func (r *Repository) ListBySession(ctx context.Context, userID, sessionID, primarySignalID uuid.UUID) ([]Record, error) {
	const q = `
		SELECT id, user_id, scope, signal_id, refinement_id, round, query, results, model, created_at
		FROM signal_research
		WHERE user_id = $1
		  AND (
		    (scope = 'refinement_round' AND refinement_id = $2)
		    OR (scope = 'signal' AND signal_id = $3)
		  )
		ORDER BY scope ASC, COALESCE(round, 0) ASC, created_at ASC
	`
	rows, err := r.pool.Query(ctx, q, userID, sessionID, primarySignalID)
	if err != nil {
		return nil, fmt.Errorf("query research: %w", err)
	}
	defer rows.Close()

	return scanRecords(rows)
}

// ListBySignal 用于"信号详情页"未来扩展. 当前 mobile 不直接用, 留 endpoint.
func (r *Repository) ListBySignal(ctx context.Context, userID, signalID uuid.UUID) ([]Record, error) {
	const q = `
		SELECT id, user_id, scope, signal_id, refinement_id, round, query, results, model, created_at
		FROM signal_research
		WHERE user_id = $1 AND signal_id = $2
		ORDER BY scope ASC, COALESCE(round, 0) ASC, created_at ASC
	`
	rows, err := r.pool.Query(ctx, q, userID, signalID)
	if err != nil {
		return nil, fmt.Errorf("query research: %w", err)
	}
	defer rows.Close()
	return scanRecords(rows)
}

func scanRecords(rows pgx.Rows) ([]Record, error) {
	out := make([]Record, 0, 8)
	for rows.Next() {
		var (
			rec      Record
			scope    string
			raw      []byte
		)
		if err := rows.Scan(
			&rec.ID, &rec.UserID, &scope, &rec.SignalID, &rec.RefinementID, &rec.Round,
			&rec.Query, &raw, &rec.Model, &rec.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan research: %w", err)
		}
		rec.Scope = Scope(scope)
		if err := json.Unmarshal(raw, &rec.Results); err != nil {
			return nil, fmt.Errorf("unmarshal results: %w", err)
		}
		out = append(out, rec)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iter research: %w", err)
	}
	return out, nil
}
