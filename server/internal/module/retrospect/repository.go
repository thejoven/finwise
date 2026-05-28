// Package retrospect is the M11 复盘训练 module.
//
// 状态机: pending → in_progress → finalized.
// 用户答完 4 道题 (1=perception, 2=inference, 3=evaluation, 4=execution),
// finalize 时启发式或 Mastra Diagnostician 给出 focus_dim + focus_text,
// 然后同事务写到 user_training_state.training_focuses (M11.5).
package retrospect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"flashfi/server/internal/domain"
	"flashfi/server/internal/infra/db"
)

const trainingFocusKeepN = 5

var (
	ErrNotFound          = errors.New("retrospect not found")
	ErrAlreadyFinalized  = errors.New("retrospect already finalized")
	ErrInvalidState      = errors.New("retrospect not in expected state")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

type Retrospect struct {
	ID                 uuid.UUID
	UserID             uuid.UUID
	CommitmentID       uuid.UUID
	State              string
	StartedAt          time.Time
	FinalizedAt        *time.Time
	Answers            []AnswerEntry
	FocusDim           *string
	FocusText          *string
	DiagnosticianModel *string
}

type AnswerEntry struct {
	Q        int                       `json:"q"`
	Dim      domain.RetrospectDimension `json:"dim"`
	Choice   string                    `json:"choice"`
	OpenText *string                   `json:"open_text,omitempty"`
}

// ───── Start ─────

type StartInput struct {
	UserID       uuid.UUID
	CommitmentID uuid.UUID
	Trigger      domain.RetrospectTrigger
}

// Start 创建 pending 复盘 (idempotent on commitment_id via UNIQUE).
// 内部用一个事务: events.retrospect.started + retrospects insert + outbox.
func (r *Repository) Start(ctx context.Context, in StartInput) (*Retrospect, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	retrospectID := uuid.New()
	now := time.Now().UTC()
	payload := domain.RetrospectStartedPayload{
		RetrospectID: retrospectID,
		CommitmentID: in.CommitmentID,
		UserID:       in.UserID,
		StartedAt:    now,
		Trigger:      in.Trigger,
	}
	payloadBytes, _ := json.Marshal(payload)

	cid := uuid.NewSHA1(uuid.NameSpaceOID, []byte("retrospect-started:"+in.CommitmentID.String()))

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		in.UserID, cid, string(domain.EventRetrospectStarted), payloadBytes, now,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 已存在 — 返回已有的
			existing, err := r.getByCommitmentInTx(ctx, tx, in.UserID, in.CommitmentID)
			if err != nil {
				return nil, err
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return existing, nil
		}
		return nil, fmt.Errorf("insert retrospect.started event: %w", err)
	}

	const insertRetrospect = `
		INSERT INTO retrospects (id, user_id, commitment_id, started_at, state, answers, updated_at)
		VALUES ($1, $2, $3, $4, 'pending', '[]', $4)
		ON CONFLICT (commitment_id) DO NOTHING
		RETURNING id
	`
	var insertedID uuid.UUID
	if err := tx.QueryRow(ctx, insertRetrospect, retrospectID, in.UserID, in.CommitmentID, now).Scan(&insertedID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 已经有 — 从 db 里 select 真实 id
			existing, err := r.getByCommitmentInTx(ctx, tx, in.UserID, in.CommitmentID)
			if err != nil {
				return nil, err
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return existing, nil
		}
		return nil, fmt.Errorf("insert retrospect row: %w", err)
	}

	if err := insertOutbox(ctx, tx, eventID, domain.EventRetrospectStarted, payloadBytes); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	return &Retrospect{
		ID:           retrospectID,
		UserID:       in.UserID,
		CommitmentID: in.CommitmentID,
		State:        "pending",
		StartedAt:    now,
	}, nil
}

// ───── RecordAnswer ─────

type AnswerInput struct {
	UserID        uuid.UUID
	RetrospectID  uuid.UUID
	ClientEventID uuid.UUID
	QuestionNo    int
	Dim           domain.RetrospectDimension
	Choice        string
	OpenText      *string
}

// RecordAnswer 写 retrospect.answered event, 更新 retrospects.answers + state.
// 第 4 题答完不在这里 finalize, finalize 单独的 endpoint.
func (r *Repository) RecordAnswer(ctx context.Context, in AnswerInput) (*Retrospect, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const lock = `SELECT id, user_id, commitment_id, state, answers, started_at FROM retrospects WHERE id = $1 FOR UPDATE`
	var (
		retro Retrospect
		ans   []byte
	)
	if err := tx.QueryRow(ctx, lock, in.RetrospectID).Scan(
		&retro.ID, &retro.UserID, &retro.CommitmentID, &retro.State, &ans, &retro.StartedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if retro.UserID != in.UserID {
		return nil, ErrNotFound
	}
	if retro.State == "finalized" {
		return nil, ErrAlreadyFinalized
	}
	if err := json.Unmarshal(ans, &retro.Answers); err != nil {
		return nil, fmt.Errorf("unmarshal answers: %w", err)
	}

	// 检查 question_no 顺序 (允许同 q_no 覆盖, 客户端 retry 用)
	now := time.Now().UTC()
	payload := domain.RetrospectAnsweredPayload{
		RetrospectID: retro.ID,
		UserID:       retro.UserID,
		QuestionNo:   in.QuestionNo,
		QuestionDim:  in.Dim,
		Choice:       in.Choice,
		OpenText:     in.OpenText,
		AnsweredAt:   now,
	}
	payloadBytes, _ := json.Marshal(payload)

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		retro.UserID, in.ClientEventID, string(domain.EventRetrospectAnswered), payloadBytes, now,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 重复 - silent success
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return &retro, nil
		}
		return nil, fmt.Errorf("insert answered event: %w", err)
	}
	if err := insertOutbox(ctx, tx, eventID, domain.EventRetrospectAnswered, payloadBytes); err != nil {
		return nil, err
	}

	// 更新 answers (替换同 q_no 的旧答案, 追加新的)
	updated := make([]AnswerEntry, 0, len(retro.Answers)+1)
	replaced := false
	for _, a := range retro.Answers {
		if a.Q == in.QuestionNo {
			updated = append(updated, AnswerEntry{Q: in.QuestionNo, Dim: in.Dim, Choice: in.Choice, OpenText: in.OpenText})
			replaced = true
		} else {
			updated = append(updated, a)
		}
	}
	if !replaced {
		updated = append(updated, AnswerEntry{Q: in.QuestionNo, Dim: in.Dim, Choice: in.Choice, OpenText: in.OpenText})
	}
	updatedJSON, _ := json.Marshal(updated)

	newState := "in_progress"
	if len(updated) >= 4 {
		newState = "in_progress" // finalize 要走单独 endpoint, 不在这里 auto-finalize
	}

	const updateRow = `
		UPDATE retrospects SET answers = $1, state = $2, updated_at = $3 WHERE id = $4
	`
	if _, err := tx.Exec(ctx, updateRow, updatedJSON, newState, now, retro.ID); err != nil {
		return nil, err
	}

	retro.Answers = updated
	retro.State = newState

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return &retro, nil
}

// ───── Finalize ─────

type FinalizeInput struct {
	UserID             uuid.UUID
	RetrospectID       uuid.UUID
	FocusDim           domain.FocusDim
	FocusText          string
	DiagnosticianModel string
}

// Finalize 标 retrospect = finalized, 写 retrospect.finalized + training.focus.updated 事件,
// 同事务把 focus 推到 user_training_state.training_focuses (保留最近 5 条).
func (r *Repository) Finalize(ctx context.Context, in FinalizeInput) (*Retrospect, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const lock = `
		SELECT id, user_id, commitment_id, state, answers, started_at
		FROM retrospects WHERE id = $1 FOR UPDATE
	`
	var (
		retro Retrospect
		ans   []byte
	)
	if err := tx.QueryRow(ctx, lock, in.RetrospectID).Scan(
		&retro.ID, &retro.UserID, &retro.CommitmentID, &retro.State, &ans, &retro.StartedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if retro.UserID != in.UserID {
		return nil, ErrNotFound
	}
	if retro.State == "finalized" {
		return nil, ErrAlreadyFinalized
	}
	if err := json.Unmarshal(ans, &retro.Answers); err != nil {
		return nil, err
	}
	if len(retro.Answers) < 4 {
		return nil, fmt.Errorf("%w: need 4 answers, have %d", ErrInvalidState, len(retro.Answers))
	}

	now := time.Now().UTC()
	finalizedPayload := domain.RetrospectFinalizedPayload{
		RetrospectID:       retro.ID,
		UserID:             retro.UserID,
		FocusDim:           in.FocusDim,
		FocusText:          in.FocusText,
		DiagnosticianModel: in.DiagnosticianModel,
		FinalizedAt:        now,
	}
	finalizedBytes, _ := json.Marshal(finalizedPayload)
	finalizedCID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("retrospect-finalized:"+retro.ID.String()))

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var finalizedEventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		retro.UserID, finalizedCID, string(domain.EventRetrospectFinalized), finalizedBytes, now,
	).Scan(&finalizedEventID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("insert finalized event: %w", err)
	}
	if finalizedEventID > 0 {
		if err := insertOutbox(ctx, tx, finalizedEventID, domain.EventRetrospectFinalized, finalizedBytes); err != nil {
			return nil, err
		}
	}

	const updateRow = `
		UPDATE retrospects
			SET state = 'finalized', finalized_at = $1, focus_dim = $2, focus_text = $3,
			    diagnostician_model = $4, updated_at = $1
		WHERE id = $5
	`
	if _, err := tx.Exec(ctx, updateRow,
		now, string(in.FocusDim), in.FocusText, in.DiagnosticianModel, retro.ID,
	); err != nil {
		return nil, err
	}

	// M11.5 · 写到 user_training_state
	focusEntry := map[string]any{
		"retrospect_id": retro.ID.String(),
		"focus_dim":     string(in.FocusDim),
		"focus_text":    in.FocusText,
		"applied_from":  now.Format(time.RFC3339),
	}
	if err := upsertTrainingFocus(ctx, tx, retro.UserID, focusEntry); err != nil {
		return nil, err
	}

	// 也写 training.focus.updated 事件
	tfPayload := domain.TrainingFocusUpdatedPayload{
		UserID:       retro.UserID,
		RetrospectID: retro.ID,
		FocusDim:     in.FocusDim,
		FocusText:    in.FocusText,
		AppliesFrom:  now,
	}
	tfBytes, _ := json.Marshal(tfPayload)
	tfCID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("training-focus:"+retro.ID.String()))
	var tfEventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		retro.UserID, tfCID, string(domain.EventTrainingFocusUpdated), tfBytes, now,
	).Scan(&tfEventID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("insert training.focus.updated: %w", err)
	}
	if tfEventID > 0 {
		if err := insertOutbox(ctx, tx, tfEventID, domain.EventTrainingFocusUpdated, tfBytes); err != nil {
			return nil, err
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}

	focusDim := string(in.FocusDim)
	focusText := in.FocusText
	diag := in.DiagnosticianModel
	retro.State = "finalized"
	retro.FinalizedAt = &now
	retro.FocusDim = &focusDim
	retro.FocusText = &focusText
	retro.DiagnosticianModel = &diag
	return &retro, nil
}

// ───── reads ─────

func (r *Repository) Get(ctx context.Context, userID, id uuid.UUID) (*Retrospect, error) {
	const q = `
		SELECT id, user_id, commitment_id, started_at, finalized_at, state, answers,
		       focus_dim, focus_text, diagnostician_model
		FROM retrospects WHERE id = $1 AND user_id = $2
	`
	return scanRetrospect(r.pool.QueryRow(ctx, q, id, userID))
}

func (r *Repository) GetByCommitment(ctx context.Context, userID, commitmentID uuid.UUID) (*Retrospect, error) {
	const q = `
		SELECT id, user_id, commitment_id, started_at, finalized_at, state, answers,
		       focus_dim, focus_text, diagnostician_model
		FROM retrospects WHERE commitment_id = $1 AND user_id = $2
	`
	return scanRetrospect(r.pool.QueryRow(ctx, q, commitmentID, userID))
}

func (r *Repository) List(ctx context.Context, userID uuid.UUID, limit int) ([]Retrospect, error) {
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	const q = `
		SELECT id, user_id, commitment_id, started_at, finalized_at, state, answers,
		       focus_dim, focus_text, diagnostician_model
		FROM retrospects WHERE user_id = $1 ORDER BY started_at DESC LIMIT $2
	`
	rows, err := r.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make([]Retrospect, 0, limit)
	for rows.Next() {
		retro, err := scanRetrospect(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *retro)
	}
	return out, rows.Err()
}

// LatestTrainingFocus 返回当前用户最近的 training focus, 用于下一次 M5 五轮追问 prompt 注入.
func (r *Repository) LatestTrainingFocus(ctx context.Context, userID uuid.UUID) (focusDim, focusText string, err error) {
	const q = `SELECT training_focuses FROM user_training_state WHERE user_id = $1`
	var raw []byte
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return "", "", nil
		}
		return "", "", err
	}
	var focuses []map[string]any
	if err := json.Unmarshal(raw, &focuses); err != nil {
		return "", "", err
	}
	if len(focuses) == 0 {
		return "", "", nil
	}
	first := focuses[0]
	if d, ok := first["focus_dim"].(string); ok {
		focusDim = d
	}
	if t, ok := first["focus_text"].(string); ok {
		focusText = t
	}
	return focusDim, focusText, nil
}

// ───── helpers ─────

func (r *Repository) getByCommitmentInTx(ctx context.Context, tx pgx.Tx, userID, commitmentID uuid.UUID) (*Retrospect, error) {
	const q = `
		SELECT id, user_id, commitment_id, started_at, finalized_at, state, answers,
		       focus_dim, focus_text, diagnostician_model
		FROM retrospects WHERE commitment_id = $1 AND user_id = $2
	`
	return scanRetrospect(tx.QueryRow(ctx, q, commitmentID, userID))
}

type rowScanner interface {
	Scan(...any) error
}

func scanRetrospect(r rowScanner) (*Retrospect, error) {
	var (
		retro Retrospect
		ans   []byte
	)
	if err := r.Scan(
		&retro.ID, &retro.UserID, &retro.CommitmentID, &retro.StartedAt, &retro.FinalizedAt,
		&retro.State, &ans, &retro.FocusDim, &retro.FocusText, &retro.DiagnosticianModel,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if err := json.Unmarshal(ans, &retro.Answers); err != nil {
		return nil, fmt.Errorf("unmarshal answers: %w", err)
	}
	return &retro, nil
}

// upsertTrainingFocus 把新 focus 推到 user_training_state, 保持最近 5 条.
func upsertTrainingFocus(ctx context.Context, tx pgx.Tx, userID uuid.UUID, entry map[string]any) error {
	// 先 select 现有 (若无则 [])
	const sel = `SELECT training_focuses FROM user_training_state WHERE user_id = $1`
	var raw []byte
	err := tx.QueryRow(ctx, sel, userID).Scan(&raw)
	if err != nil && !errors.Is(err, pgx.ErrNoRows) {
		return fmt.Errorf("load training focuses: %w", err)
	}
	var focuses []map[string]any
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &focuses)
	}

	// 新条目放最前, 保留 N 条
	merged := append([]map[string]any{entry}, focuses...)
	if len(merged) > trainingFocusKeepN {
		merged = merged[:trainingFocusKeepN]
	}
	updatedJSON, _ := json.Marshal(merged)

	const upsert = `
		INSERT INTO user_training_state (user_id, training_focuses, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (user_id) DO UPDATE SET training_focuses = EXCLUDED.training_focuses, updated_at = NOW()
	`
	if _, err := tx.Exec(ctx, upsert, userID, updatedJSON); err != nil {
		return fmt.Errorf("upsert training focuses: %w", err)
	}
	return nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, eventID int64, et domain.EventType, payload []byte) error {
	const q = `INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)`
	if _, err := tx.Exec(ctx, q, eventID, string(et), payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}
