package signal

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"flashfi/server/internal/domain"
	"flashfi/server/internal/infra/db"
)

var ErrNotFound = errors.New("signal not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// CaptureInput is the data needed to record a new signal.
type CaptureInput struct {
	UserID        uuid.UUID
	ClientEventID uuid.UUID
	RawText       string
	CapturedAt    time.Time
}

// CaptureResult is what comes back from Capture.
type CaptureResult struct {
	Signal    *domain.Signal
	EventID   int64
	Duplicate bool // true if (user_id, client_event_id) already existed
}

// Capture writes a signal.captured event + signals row + outbox row,
// all in one transaction. This is the atomic write that backs POST /v1/signals.
//
// If the (user_id, client_event_id) pair is a duplicate, returns the existing
// signal with Duplicate=true (the client retried; we replay the same result).
func (r *Repository) Capture(ctx context.Context, in CaptureInput) (*CaptureResult, error) {
	signalID := uuid.New()
	payload := domain.SignalCapturedPayload{
		SignalID:   signalID,
		UserID:     in.UserID,
		RawText:    in.RawText,
		CapturedAt: in.CapturedAt,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal payload: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1) events row
	const insertEvent = `
		INSERT INTO events (
			user_id, client_event_id, type, payload,
			occurred_at,
			related_thesis, related_asset
		) VALUES ($1, $2, $3, $4, $5, NULL, NULL)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	row := tx.QueryRow(ctx, insertEvent,
		in.UserID, in.ClientEventID, string(domain.EventSignalCaptured),
		payloadBytes, in.CapturedAt,
	)
	if err := row.Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Duplicate. Find the prior signal and return it.
			existing, lookupErr := r.findByClientEventID(ctx, tx, in.UserID, in.ClientEventID)
			if lookupErr != nil {
				return nil, fmt.Errorf("duplicate detected, lookup failed: %w", lookupErr)
			}
			if commitErr := tx.Commit(ctx); commitErr != nil {
				return nil, fmt.Errorf("commit (dup): %w", commitErr)
			}
			return &CaptureResult{Signal: existing.Signal, EventID: existing.EventID, Duplicate: true}, nil
		}
		return nil, fmt.Errorf("insert event: %w", err)
	}

	// 2) signals row
	const insertSignal = `
		INSERT INTO signals (
			id, user_id, raw_text, captured_at, source_event_id
		) VALUES ($1, $2, $3, $4, $5)
	`
	if _, err := tx.Exec(ctx, insertSignal,
		signalID, in.UserID, in.RawText, in.CapturedAt, eventID,
	); err != nil {
		return nil, fmt.Errorf("insert signal: %w", err)
	}

	// 3) outbox row — published by NATS worker after commit
	const insertOutbox = `
		INSERT INTO event_outbox (event_id, subject, payload)
		VALUES ($1, $2, $3)
	`
	if _, err := tx.Exec(ctx, insertOutbox,
		eventID, string(domain.EventSignalCaptured), payloadBytes,
	); err != nil {
		return nil, fmt.Errorf("insert outbox: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &CaptureResult{
		Signal: &domain.Signal{
			ID:              signalID,
			UserID:          in.UserID,
			RawText:         in.RawText,
			CapturedAt:      in.CapturedAt,
			SourceEventID:   eventID,
			InferenceStatus: domain.InferenceStatusPending,
		},
		EventID:   eventID,
		Duplicate: false,
	}, nil
}

type existingCapture struct {
	Signal  *domain.Signal
	EventID int64
}

func (r *Repository) findByClientEventID(ctx context.Context, tx pgx.Tx, userID, cid uuid.UUID) (*existingCapture, error) {
	const q = `
		SELECT e.id, s.id, s.raw_text, s.captured_at, s.inference_status,
		       s.inference_summary, s.inference_tags, s.inference_model, s.inference_done_at,
		       s.created_at, s.updated_at
		FROM events e
		JOIN signals s ON s.source_event_id = e.id
		WHERE e.user_id = $1 AND e.client_event_id = $2
	`
	var (
		eventID         int64
		sig             domain.Signal
		statusStr       string
	)
	sig.UserID = userID
	err := tx.QueryRow(ctx, q, userID, cid).Scan(
		&eventID, &sig.ID, &sig.RawText, &sig.CapturedAt, &statusStr,
		&sig.InferenceSummary, &sig.InferenceTags, &sig.InferenceModel, &sig.InferenceDoneAt,
		&sig.CreatedAt, &sig.UpdatedAt,
	)
	if err != nil {
		return nil, err
	}
	sig.SourceEventID = eventID
	sig.InferenceStatus = domain.InferenceStatus(statusStr)
	return &existingCapture{Signal: &sig, EventID: eventID}, nil
}

// EnqueueReinferOutbox 写一行新 outbox (subject=signal.captured) 复用同一
// source_event_id, 让 mastra 重新消费这条 signal 跑一次 analyst.
//
// 不写新 event 行 — 保持事件溯源历史干净; 真相只是 "用户请求 server 把这条
// signal 重投给推演队列", 不是"信号被重新捕获".
func (r *Repository) EnqueueReinferOutbox(ctx context.Context, sig *domain.Signal) error {
	payload := domain.SignalCapturedPayload{
		SignalID:   sig.ID,
		UserID:     sig.UserID,
		RawText:    sig.RawText,
		CapturedAt: sig.CapturedAt,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal payload: %w", err)
	}
	const q = `
		INSERT INTO event_outbox (event_id, subject, payload)
		VALUES ($1, $2, $3)
	`
	if _, err := r.pool.Exec(ctx, q,
		sig.SourceEventID, string(domain.EventSignalCaptured), payloadBytes,
	); err != nil {
		return fmt.Errorf("insert reinfer outbox: %w", err)
	}
	return nil
}

// ListInput is the filter/page args for ListByUser.
type ListInput struct {
	UserID uuid.UUID
	Before *time.Time // captured_at < Before (cursor pagination)
	Limit  int
	Query  string // 非空 → ILIKE raw_text/inference_summary; 已经 trim 过.
}

// List returns signals for the user, newest first, with a cursor on captured_at.
// 当 Query 非空时附加 ILIKE 过滤 (raw_text 或 inference_summary). 数据量小,
// 没建 trigram 索引也够用; 大了再加 pg_trgm.
func (r *Repository) List(ctx context.Context, in ListInput) ([]domain.Signal, bool, error) {
	if in.Limit <= 0 || in.Limit > 100 {
		in.Limit = 20
	}

	// +1 to detect has_more
	limit := in.Limit + 1

	// 动态拼 WHERE — 加一个 q 维度就 4 种组合, 用 args slice 比 fmt 模板清楚.
	const baseSelect = `
		SELECT id, user_id, raw_text, captured_at, source_event_id,
		       inference_status, inference_summary, inference_tags,
		       inference_model, inference_done_at,
		       created_at, updated_at
		FROM signals
		WHERE user_id = $1
	`
	args := []any{in.UserID}
	sql := baseSelect

	if in.Query != "" {
		// %escape% 防 SQL LIKE wildcard 误命中.
		pattern := "%" + escapeLike(in.Query) + "%"
		args = append(args, pattern)
		sql += fmt.Sprintf(" AND (raw_text ILIKE $%d OR COALESCE(inference_summary, '') ILIKE $%d)", len(args), len(args))
	}
	if in.Before != nil {
		args = append(args, *in.Before)
		sql += fmt.Sprintf(" AND captured_at < $%d", len(args))
	}
	args = append(args, limit)
	sql += fmt.Sprintf(" ORDER BY captured_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, sql, args...)
	if err != nil {
		return nil, false, fmt.Errorf("query signals: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Signal, 0, limit)
	for rows.Next() {
		s, err := scanSignal(rows)
		if err != nil {
			return nil, false, err
		}
		out = append(out, *s)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("rows iter: %w", err)
	}

	hasMore := len(out) > in.Limit
	if hasMore {
		out = out[:in.Limit]
	}
	return out, hasMore, nil
}

// Get returns a single signal by id.
func (r *Repository) Get(ctx context.Context, userID, id uuid.UUID) (*domain.Signal, error) {
	const q = `
		SELECT id, user_id, raw_text, captured_at, source_event_id,
		       inference_status, inference_summary, inference_tags,
		       inference_model, inference_done_at,
		       created_at, updated_at
		FROM signals
		WHERE user_id = $1 AND id = $2
	`
	row := r.pool.QueryRow(ctx, q, userID, id)
	s, err := scanSignal(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return s, nil
}

// RecordInference applies an analyst inference: writes a
// signal.inference.done event + updates the signals row + outbox row,
// all in one transaction.
func (r *Repository) RecordInference(ctx context.Context, payload domain.SignalInferenceDonePayload, sourceEventID int64) error {
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal inference payload: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Event row. client_event_id derived from signal_id so retries are idempotent
	// at the events layer (analyst worker may redeliver the same inference).
	clientEventID := uuid.NewSHA1(uuid.NameSpaceOID, append([]byte("inference:"), payload.SignalID[:]...))

	const insertEvent = `
		INSERT INTO events (
			user_id, client_event_id, type, payload, occurred_at,
			causation_id
		) VALUES ($1, $2, $3, $4, NOW(), $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		payload.UserID, clientEventID, string(domain.EventSignalInferenceDone),
		payloadBytes, sourceEventID,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// Already recorded — no-op idempotent return.
			return tx.Commit(ctx)
		}
		return fmt.Errorf("insert inference event: %w", err)
	}

	const updateSignal = `
		UPDATE signals SET
			inference_status   = 'done',
			inference_summary  = $1,
			inference_tags     = $2,
			inference_model    = $3,
			inference_done_at  = NOW(),
			updated_at         = NOW()
		WHERE id = $4 AND user_id = $5
	`
	tag, err := tx.Exec(ctx, updateSignal,
		payload.Summary, payload.Tags, payload.Model, payload.SignalID, payload.UserID,
	)
	if err != nil {
		return fmt.Errorf("update signal: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return fmt.Errorf("update signal: signal %s not found for user %s", payload.SignalID, payload.UserID)
	}

	// Outbox so client streams can listen if we ever add SSE in Phase 2.
	const insertOutbox = `
		INSERT INTO event_outbox (event_id, subject, payload)
		VALUES ($1, $2, $3)
	`
	if _, err := tx.Exec(ctx, insertOutbox,
		eventID, string(domain.EventSignalInferenceDone), payloadBytes,
	); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}

	return tx.Commit(ctx)
}

// escapeLike 把 LIKE wildcard 字符转义掉, 让用户输入按字面匹配.
// pg 默认 escape 字符是 '\'. 不处理用户传 '\' 的边界 — 实在边缘.
func escapeLike(s string) string {
	r := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return r.Replace(s)
}

// rowScanner is satisfied by both pgx.Row and pgx.Rows.
type rowScanner interface {
	Scan(dest ...any) error
}

func scanSignal(r rowScanner) (*domain.Signal, error) {
	var (
		s         domain.Signal
		statusStr string
		tags      []string
	)
	if err := r.Scan(
		&s.ID, &s.UserID, &s.RawText, &s.CapturedAt, &s.SourceEventID,
		&statusStr, &s.InferenceSummary, &tags,
		&s.InferenceModel, &s.InferenceDoneAt,
		&s.CreatedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	s.InferenceStatus = domain.InferenceStatus(statusStr)
	s.InferenceTags = tags
	return &s, nil
}
