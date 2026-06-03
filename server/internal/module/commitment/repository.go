// Package commitment is the M7 承诺书 + M8 签字 module.
//
// commitments 表是文书层 (drafted/signed/postponed/abandoned), holdings 是签字后
// 的状态机 (active/triggered/expired/closed/archived). 1:1, id 共享.
//
// 关键 invariant (Phase 2 plan § 2.2):
//   - signed 状态不可逆 (migration 004 的 trigger 守门 + Go 也守一遍)
//   - reasons_for_future_self 必须 verbatim 引用 signal.raw_text (Mastra 校验, 这里只信任)
//   - postpone_count ≥ 3 → 自动 abandoned
package commitment

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

const PostponeThreshold = 3

var (
	ErrNotFound      = errors.New("commitment not found")
	ErrAlreadySigned = errors.New("commitment already signed")
	ErrAbandoned     = errors.New("commitment abandoned")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Commitment mirrors a commitments row.
type Commitment struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	EvaluationID  uuid.UUID
	Status        string // drafted | signed | postponed | abandoned
	Thesis        domain.Thesis
	PDFPath       *string
	PostponeCount int
	SignedAt      *time.Time
	DraftedAt     time.Time
	UpdatedAt     time.Time
	// ProjectID 是经 evaluation→refinement→signal JOIN 回 signals 得到的分类标签
	// (不在 commitments 落列). 仅 GetByID / LoadActive 填充, 其余读路径为 nil.
	ProjectID *uuid.UUID
}

// Holding mirrors a holdings row.
type Holding struct {
	ID             uuid.UUID
	UserID         uuid.UUID
	Status         string // active | triggered | expired | closed | archived
	SignedAt       time.Time
	ExitConditions []string
	ExpiresAt      time.Time
	ExitCheckState json.RawMessage
	TriggeredAt    *time.Time
	ClosedAt       *time.Time
	ArchivedAt     *time.Time
	UpdatedAt      time.Time
}

// ───── Draft (M7) ─────

type InsertDraftInput struct {
	UserID       uuid.UUID
	EvaluationID uuid.UUID
	Thesis       domain.Thesis
	Model        string
}

// InsertDraft 写 events.commitment.drafted + commitments row + outbox.
// Idempotent on (evaluation_id) — 同一评估只能产一份承诺书.
func (r *Repository) InsertDraft(ctx context.Context, in InsertDraftInput) (*Commitment, error) {
	now := time.Now().UTC()
	commitID := uuid.New()
	payload := domain.CommitmentDraftedPayload{
		CommitmentID: commitID,
		UserID:       in.UserID,
		EvaluationID: in.EvaluationID,
		Thesis:       in.Thesis,
		Model:        in.Model,
		DraftedAt:    now,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal drafted payload: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// client_event_id 由 evaluation_id 派生防重
	cid := uuid.NewSHA1(uuid.NameSpaceOID,
		append([]byte("commitment-drafted:"), in.EvaluationID[:]...))

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		in.UserID, cid, string(domain.EventCommitmentDrafted), payloadBytes, now,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 已有 — 返回现存的
			return r.getByEvaluation(ctx, tx, in.UserID, in.EvaluationID)
		}
		return nil, fmt.Errorf("insert drafted event: %w", err)
	}

	thesisJSON, err := json.Marshal(in.Thesis)
	if err != nil {
		return nil, fmt.Errorf("marshal thesis: %w", err)
	}

	const insertCommit = `
		INSERT INTO commitments
			(id, user_id, evaluation_id, status, thesis, drafted_at, updated_at)
		VALUES ($1, $2, $3, 'drafted', $4, $5, $5)
	`
	if _, err := tx.Exec(ctx, insertCommit, commitID, in.UserID, in.EvaluationID, thesisJSON, now); err != nil {
		return nil, fmt.Errorf("insert commitment: %w", err)
	}

	if err := insertOutbox(ctx, tx, eventID, domain.EventCommitmentDrafted, payloadBytes); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &Commitment{
		ID:           commitID,
		UserID:       in.UserID,
		EvaluationID: in.EvaluationID,
		Status:       "drafted",
		Thesis:       in.Thesis,
		DraftedAt:    now,
		UpdatedAt:    now,
	}, nil
}

// ───── Sign (M8) ─────

type SignInput struct {
	UserID          uuid.UUID
	CommitmentID    uuid.UUID
	SigningClientID string // 防双击的客户端幂等 key
}

// Sign 是 M8 核心. 事务保证:
//   - events.commitment.signed (client_event_id = signing_client_id, ON CONFLICT DO NOTHING)
//   - commitments status → signed, signed_at = NOW
//   - holdings row 新建 (active, exit_conditions 从 thesis 复制, expires_at 计算)
//   - outbox commitment.signed
//
// 幂等: 同一 signing_client_id 重发 → 静默成功, 返回已签状态.
func (r *Repository) Sign(ctx context.Context, in SignInput) (*Commitment, *Holding, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 锁 commitment 行
	const lockCommit = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments WHERE id = $1 AND user_id = $2 FOR UPDATE
	`
	commit, err := scanCommitmentRow(tx.QueryRow(ctx, lockCommit, in.CommitmentID, in.UserID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil, ErrNotFound
		}
		return nil, nil, fmt.Errorf("lock commitment: %w", err)
	}

	switch commit.Status {
	case "signed":
		// 已经签了 — 返回 holding 也就行了
		holding, err := r.getHolding(ctx, tx, commit.ID)
		if err != nil {
			return nil, nil, err
		}
		if err := tx.Commit(ctx); err != nil {
			return nil, nil, err
		}
		return commit, holding, nil
	case "abandoned":
		return nil, nil, ErrAbandoned
	case "drafted", "postponed":
		// ok, 可签
	default:
		return nil, nil, fmt.Errorf("unexpected commitment status: %s", commit.Status)
	}

	now := time.Now().UTC()
	payload := domain.CommitmentSignedPayload{
		CommitmentID:    commit.ID,
		UserID:          commit.UserID,
		SignedAt:        now,
		SigningClientID: in.SigningClientID,
	}
	payloadBytes, _ := json.Marshal(payload)

	// signing_client_id 转成 UUID 做 client_event_id (signing_client_id 必须是合法 uuid format)
	cid, parseErr := uuid.Parse(in.SigningClientID)
	if parseErr != nil {
		// 非 uuid → 派生
		cid = uuid.NewSHA1(uuid.NameSpaceOID, []byte("commitment-signed:"+in.SigningClientID))
	}

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		commit.UserID, cid, string(domain.EventCommitmentSigned), payloadBytes, now,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 重复 client_event_id — 静默成功 (用户连点两次)
			if err := tx.Commit(ctx); err != nil {
				return nil, nil, err
			}
			return r.Get(ctx, commit.UserID, commit.ID), nil, nil
		}
		return nil, nil, fmt.Errorf("insert signed event: %w", err)
	}

	const updateCommit = `
		UPDATE commitments SET status = 'signed', signed_at = $1, updated_at = $1
		WHERE id = $2
	`
	if _, err := tx.Exec(ctx, updateCommit, now, commit.ID); err != nil {
		return nil, nil, fmt.Errorf("update commitment: %w", err)
	}

	// 新建 holding
	expiresAt := now.AddDate(0, commit.Thesis.DurationMonths, 0)
	exitJSON, _ := json.Marshal(commit.Thesis.ExitConditions)
	const insertHolding = `
		INSERT INTO holdings
			(id, user_id, status, signed_at, exit_conditions, expires_at, updated_at)
		VALUES ($1, $2, 'active', $3, $4, $5, $3)
	`
	if _, err := tx.Exec(ctx, insertHolding,
		commit.ID, commit.UserID, now, exitJSON, expiresAt,
	); err != nil {
		return nil, nil, fmt.Errorf("insert holding: %w", err)
	}

	if err := insertOutbox(ctx, tx, eventID, domain.EventCommitmentSigned, payloadBytes); err != nil {
		return nil, nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, nil, err
	}

	commit.Status = "signed"
	commit.SignedAt = &now
	commit.UpdatedAt = now
	holding := &Holding{
		ID:             commit.ID,
		UserID:         commit.UserID,
		Status:         "active",
		SignedAt:       now,
		ExitConditions: commit.Thesis.ExitConditions,
		ExpiresAt:      expiresAt,
		ExitCheckState: json.RawMessage(`{}`),
		UpdatedAt:      now,
	}
	return commit, holding, nil
}

// ───── Postpone (M8) ─────

type PostponeInput struct {
	UserID        uuid.UUID
	CommitmentID  uuid.UUID
	ClientEventID uuid.UUID
	Reason        *string
}

// Postpone 写 events.commitment.postponed, count+1. count>=3 自动 abandoned.
func (r *Repository) Postpone(ctx context.Context, in PostponeInput) (*Commitment, error) {
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const lock = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments WHERE id = $1 AND user_id = $2 FOR UPDATE
	`
	commit, err := scanCommitmentRow(tx.QueryRow(ctx, lock, in.CommitmentID, in.UserID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	if commit.Status == "signed" {
		return nil, ErrAlreadySigned
	}
	if commit.Status == "abandoned" {
		return nil, ErrAbandoned
	}

	now := time.Now().UTC()
	newCount := commit.PostponeCount + 1

	postponedPayload := domain.CommitmentPostponedPayload{
		CommitmentID: commit.ID,
		UserID:       commit.UserID,
		Count:        newCount,
		Reason:       in.Reason,
		PostponedAt:  now,
	}
	postBytes, _ := json.Marshal(postponedPayload)

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		commit.UserID, in.ClientEventID, string(domain.EventCommitmentPostponed), postBytes, now,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 重复 — 静默
			if err := tx.Commit(ctx); err != nil {
				return nil, err
			}
			return commit, nil
		}
		return nil, err
	}

	if err := insertOutbox(ctx, tx, eventID, domain.EventCommitmentPostponed, postBytes); err != nil {
		return nil, err
	}

	// 自动 abandon
	if newCount >= PostponeThreshold {
		abandonedPayload := domain.CommitmentAbandonedPayload{
			CommitmentID: commit.ID,
			UserID:       commit.UserID,
			ReasonKind:   domain.AbandonPostponeThreshold,
			AbandonedAt:  now,
		}
		abandonedBytes, _ := json.Marshal(abandonedPayload)
		abandonedCID := uuid.NewSHA1(uuid.NameSpaceOID,
			append([]byte("commitment-abandoned:"), commit.ID[:]...))
		var abEventID int64
		if err := tx.QueryRow(ctx, insertEvent,
			commit.UserID, abandonedCID, string(domain.EventCommitmentAbandoned), abandonedBytes, now,
		).Scan(&abEventID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, err
		}
		if abEventID > 0 {
			if err := insertOutbox(ctx, tx, abEventID, domain.EventCommitmentAbandoned, abandonedBytes); err != nil {
				return nil, err
			}
		}

		const markAbandoned = `
			UPDATE commitments SET status = 'abandoned', postpone_count = $1, updated_at = $2
			WHERE id = $3
		`
		if _, err := tx.Exec(ctx, markAbandoned, newCount, now, commit.ID); err != nil {
			return nil, err
		}
		commit.Status = "abandoned"
	} else {
		const markPostponed = `
			UPDATE commitments SET status = 'postponed', postpone_count = $1, updated_at = $2
			WHERE id = $3
		`
		if _, err := tx.Exec(ctx, markPostponed, newCount, now, commit.ID); err != nil {
			return nil, err
		}
		commit.Status = "postponed"
	}

	commit.PostponeCount = newCount
	commit.UpdatedAt = now

	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return commit, nil
}

// ───── reads ─────

// projectIDForCommitment 经 evaluation→refinement→signal JOIN 回 signals 拿分类标签.
// best-effort: 查不到 / 未分类 / 链不全都返回 nil, 不影响主读路径.
func (r *Repository) projectIDForCommitment(ctx context.Context, evaluationID uuid.UUID) *uuid.UUID {
	const q = `
		SELECT s.project_id
		FROM gate_evaluations ge
		JOIN refinement_sessions rs ON rs.id = ge.refinement_id
		JOIN signals s ON s.id = rs.primary_signal_id
		WHERE ge.id = $1
	`
	var pid *uuid.UUID
	_ = r.pool.QueryRow(ctx, q, evaluationID).Scan(&pid)
	return pid
}

func (r *Repository) GetByID(ctx context.Context, userID, id uuid.UUID) (*Commitment, error) {
	const q = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments WHERE id = $1 AND user_id = $2
	`
	c, err := scanCommitmentRow(r.pool.QueryRow(ctx, q, id, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.ProjectID = r.projectIDForCommitment(ctx, c.EvaluationID)
	return c, nil
}

func (r *Repository) Get(ctx context.Context, userID, id uuid.UUID) *Commitment {
	c, _ := r.GetByID(ctx, userID, id)
	return c
}

// LoadActive 返回当前唯一进行中的 commitment (drafted/signed) 或 nil.
// Phase 2 单线程: 假设至多一份.
func (r *Repository) LoadActive(ctx context.Context, userID uuid.UUID) (*Commitment, error) {
	const q = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments
		WHERE user_id = $1 AND status IN ('drafted', 'signed', 'postponed')
		ORDER BY drafted_at DESC LIMIT 1
	`
	c, err := scanCommitmentRow(r.pool.QueryRow(ctx, q, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	c.ProjectID = r.projectIDForCommitment(ctx, c.EvaluationID)
	return c, nil
}

func (r *Repository) LoadActiveHolding(ctx context.Context, userID uuid.UUID) (*Holding, error) {
	const q = `
		SELECT id, user_id, status, signed_at, exit_conditions, expires_at, exit_check_state,
		       triggered_at, closed_at, archived_at, updated_at
		FROM holdings
		WHERE user_id = $1 AND status = 'active'
		ORDER BY signed_at DESC LIMIT 1
	`
	h, err := scanHoldingRow(r.pool.QueryRow(ctx, q, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, err
	}
	return h, nil
}

func (r *Repository) GetHolding(ctx context.Context, userID, id uuid.UUID) (*Holding, error) {
	const q = `
		SELECT id, user_id, status, signed_at, exit_conditions, expires_at, exit_check_state,
		       triggered_at, closed_at, archived_at, updated_at
		FROM holdings
		WHERE id = $1 AND user_id = $2
	`
	h, err := scanHoldingRow(r.pool.QueryRow(ctx, q, id, userID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return h, nil
}

// ListCommitments 返回该用户全部承诺 (新→旧). web-admin "承诺" 列表用.
func (r *Repository) ListCommitments(ctx context.Context, userID uuid.UUID, limit int) ([]Commitment, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments
		WHERE user_id = $1
		ORDER BY drafted_at DESC
		LIMIT $2
	`
	rows, err := r.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list commitments: %w", err)
	}
	defer rows.Close()
	var out []Commitment
	for rows.Next() {
		c, err := scanCommitmentRow(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, *c)
	}
	return out, rows.Err()
}

// GetByEvaluation 按 evaluation_id 查承诺 (公开, 走 pool — 区别于 Sign 内的 tx 版).
// 给信号详情链路用 (evaluation → commitment). 找不到返回 ErrNotFound.
func (r *Repository) GetByEvaluation(ctx context.Context, userID, evalID uuid.UUID) (*Commitment, error) {
	const q = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments WHERE user_id = $1 AND evaluation_id = $2
	`
	c, err := scanCommitmentRow(r.pool.QueryRow(ctx, q, userID, evalID))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	c.ProjectID = r.projectIDForCommitment(ctx, c.EvaluationID)
	return c, nil
}

// HoldingListItem 是持仓列表行: holding + 从承诺书 thesis 取的标的/动作 (列表展示用).
type HoldingListItem struct {
	Holding
	Ticker string
	Action string
}

// ListHoldings 返回该用户全部持仓 (新→旧), JOIN commitments 取标的 ticker.
// holdings.id == commitments.id (1:1), 所以 JOIN on id.
func (r *Repository) ListHoldings(ctx context.Context, userID uuid.UUID, limit int) ([]HoldingListItem, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `
		SELECT h.id, h.user_id, h.status, h.signed_at, h.exit_conditions, h.expires_at, h.exit_check_state,
		       h.triggered_at, h.closed_at, h.archived_at, h.updated_at,
		       c.thesis->>'asset_ticker', c.thesis->>'action'
		FROM holdings h
		JOIN commitments c ON c.id = h.id
		WHERE h.user_id = $1
		ORDER BY h.signed_at DESC
		LIMIT $2
	`
	rows, err := r.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list holdings: %w", err)
	}
	defer rows.Close()
	var out []HoldingListItem
	for rows.Next() {
		var (
			h       Holding
			exitRaw []byte
			ticker  *string
			action  *string
		)
		if err := rows.Scan(
			&h.ID, &h.UserID, &h.Status, &h.SignedAt, &exitRaw, &h.ExpiresAt, &h.ExitCheckState,
			&h.TriggeredAt, &h.ClosedAt, &h.ArchivedAt, &h.UpdatedAt,
			&ticker, &action,
		); err != nil {
			return nil, fmt.Errorf("scan holding row: %w", err)
		}
		if err := json.Unmarshal(exitRaw, &h.ExitConditions); err != nil {
			return nil, fmt.Errorf("unmarshal exit_conditions: %w", err)
		}
		item := HoldingListItem{Holding: h}
		if ticker != nil {
			item.Ticker = *ticker
		}
		if action != nil {
			item.Action = *action
		}
		out = append(out, item)
	}
	return out, rows.Err()
}

// ───── private ─────

func (r *Repository) getByEvaluation(ctx context.Context, tx pgx.Tx, userID, evalID uuid.UUID) (*Commitment, error) {
	const q = `
		SELECT id, user_id, evaluation_id, status, thesis, pdf_path, postpone_count, signed_at, drafted_at, updated_at
		FROM commitments WHERE user_id = $1 AND evaluation_id = $2
	`
	c, err := scanCommitmentRow(tx.QueryRow(ctx, q, userID, evalID))
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, err
	}
	return c, nil
}

func (r *Repository) getHolding(ctx context.Context, tx pgx.Tx, id uuid.UUID) (*Holding, error) {
	const q = `
		SELECT id, user_id, status, signed_at, exit_conditions, expires_at, exit_check_state,
		       triggered_at, closed_at, archived_at, updated_at
		FROM holdings WHERE id = $1
	`
	return scanHoldingRow(tx.QueryRow(ctx, q, id))
}

type rowScanner interface {
	Scan(...any) error
}

func scanCommitmentRow(r rowScanner) (*Commitment, error) {
	var (
		c         Commitment
		thesisRaw []byte
	)
	if err := r.Scan(
		&c.ID, &c.UserID, &c.EvaluationID, &c.Status, &thesisRaw, &c.PDFPath, &c.PostponeCount,
		&c.SignedAt, &c.DraftedAt, &c.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(thesisRaw, &c.Thesis); err != nil {
		return nil, fmt.Errorf("unmarshal thesis: %w", err)
	}
	return &c, nil
}

func scanHoldingRow(r rowScanner) (*Holding, error) {
	var (
		h       Holding
		exitRaw []byte
	)
	if err := r.Scan(
		&h.ID, &h.UserID, &h.Status, &h.SignedAt, &exitRaw, &h.ExpiresAt, &h.ExitCheckState,
		&h.TriggeredAt, &h.ClosedAt, &h.ArchivedAt, &h.UpdatedAt,
	); err != nil {
		return nil, err
	}
	if err := json.Unmarshal(exitRaw, &h.ExitConditions); err != nil {
		return nil, fmt.Errorf("unmarshal exit_conditions: %w", err)
	}
	return &h, nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, eventID int64, et domain.EventType, payload []byte) error {
	const q = `INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)`
	if _, err := tx.Exec(ctx, q, eventID, string(et), payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}
