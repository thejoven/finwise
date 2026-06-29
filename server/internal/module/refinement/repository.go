// Package refinement is the M5 五轮追问 module.
//
// 仿 signal 模块结构: handler + service + repository. 这一层是 SQL + 事务.
//
// 事件溯源原则:
//   - 真实的真相在 events 表 (refinement.started / answered / completed).
//   - refinement_sessions 是 head view (cache), 让 list 快.
//   - refinement_questions 是题目缓存 (cache), 让客户端重连不重出题.
//   - cache 写失败可恢复 (从 events 重建), event 写失败不可恢复 (掉了真相).
//     所以事件写优先, cache 写在同事务里跟随.
package refinement

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"alphax/server/internal/domain"
	"alphax/server/internal/infra/db"
)

var (
	ErrNotFound      = errors.New("refinement session not found")
	ErrInvalidRound  = errors.New("round out of sequence")
	ErrAlreadyClosed = errors.New("refinement session already completed/abandoned")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// ───── Domain types (this package's external shape) ─────

type Session struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	PrimarySignalID uuid.UUID
	PrimaryAsset    *string
	Status          string // active | completed | abandoned
	RoundsDone      int
	Decision        *string // eligible_for_gate | training_only
	StartedAt       time.Time
	CompletedAt     *time.Time
	UpdatedAt       time.Time

	// Joined from signals/projects — only填充 in Get (Mastra 用), Start 返回时为空.
	PrimarySignalRawText string
	PrimarySignalSummary *string
	// Analyst 推演结论 (signals.inference_tags / inference_related_assets). 透传给 Mastra
	// Socratic 出题作参照 —— 让出题在已推的一阶/二阶受益方之上再追一层, 而非从原文重推.
	PrimarySignalTags          []string        // inference_tags
	PrimarySignalRelatedAssets json.RawMessage // inference_related_assets (jsonb 原样透传, 含 ticker/rationale/order)
	ProjectName                *string         // 分类名 (经 signal.project_id JOIN projects)
	ProjectGuidance            *string         // 分类的分析指引, 注入 socratic/narrator/attention prompt
	Language                   *string         // 用户语言 (经 user JOIN); 注入 socratic/distiller/beneficiary 让产出跟随语言
}

type Round struct {
	Round        int
	QuestionID   string
	QuestionKind domain.QuestionKind
	QuestionText string
	Options      []domain.QuestionOption
	Answer       domain.UserAnswer
	Diagnosis    domain.AnswerDiagnosis
	AnsweredAt   time.Time
}

type Question struct {
	Round   int
	Payload json.RawMessage
}

type SessionView struct {
	Session
	Rounds   []Round   // 已答 (按 round 顺序)
	Question *Question // 当前等待用户回答的题目, nil 表示还没出

	// 用户最近一次复盘的训练重点 (Mastra Socratic prompt 注入用).
	// 没有时为空字符串.
	TrainingFocusDim  string
	TrainingFocusText string
}

// ───── Start ─────

type StartInput struct {
	UserID          uuid.UUID
	ClientEventID   uuid.UUID // events 表幂等键
	SessionID       uuid.UUID // 调用方生成, 也是 sessions.id
	PrimarySignalID uuid.UUID
	PrimaryAsset    *string
}

// Start 写 refinement.started event + refinement_sessions row + outbox.
//
// 两层幂等:
//  1. 信号级 (用户语义): 同 signal 已有 active session → 直接复用 (用户对同一
//     信号点"开始追问"的产品意图是"继续上次", 不是开第二条).
//  2. 事件级 (重投递): 同 (user_id, client_event_id) → events 表 ON CONFLICT
//     DO NOTHING 命中后 findBySignalActive 兜底.
//
// race condition 兜底: 即使 1) 没命中, INSERT refinement_sessions 也可能因为
// 并发别的请求先写而撞 uq_refinement_signal_active (23505). 那就回退到 lookup.
func (r *Repository) Start(ctx context.Context, in StartInput) (*Session, error) {
	// ── 信号级幂等 (不开 tx 的快路径) ─────────────────────────────
	if existing, err := r.findBySignalActiveNoTx(ctx, in.UserID, in.PrimarySignalID); err == nil {
		return existing, nil
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("lookup existing active: %w", err)
	}

	now := time.Now().UTC()
	payload := domain.RefinementStartedPayload{
		RefinementID: in.SessionID,
		UserID:       in.UserID,
		SignalIDs:    []uuid.UUID{in.PrimarySignalID},
		PrimaryAsset: in.PrimaryAsset,
		StartedAt:    now,
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		return nil, fmt.Errorf("marshal started payload: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 1) events row
	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at, related_asset)
		VALUES ($1, $2, $3, $4, $5, $6)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	relatedAsset := in.PrimaryAsset // ok if nil
	row := tx.QueryRow(ctx, insertEvent,
		in.UserID, in.ClientEventID, string(domain.EventRefinementStarted),
		payloadBytes, now, relatedAsset,
	)
	if err := row.Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// duplicate — return existing session.
			existing, lookupErr := r.findBySignalActive(ctx, tx, in.UserID, in.PrimarySignalID)
			if lookupErr != nil {
				return nil, fmt.Errorf("dup detected, lookup failed: %w", lookupErr)
			}
			if err := tx.Commit(ctx); err != nil {
				return nil, fmt.Errorf("commit (dup): %w", err)
			}
			return existing, nil
		}
		return nil, fmt.Errorf("insert event: %w", err)
	}

	// 2) refinement_sessions row
	const insertSession = `
		INSERT INTO refinement_sessions
			(id, user_id, primary_signal_id, primary_asset, status, rounds_done, started_at, updated_at)
		VALUES ($1, $2, $3, $4, 'active', 0, $5, $5)
	`
	if _, err := tx.Exec(ctx, insertSession,
		in.SessionID, in.UserID, in.PrimarySignalID, in.PrimaryAsset, now,
	); err != nil {
		// race: 快路径没命中, 但并发请求抢先写了 active session.
		// 23505 = unique_violation, 命中 uq_refinement_user_signal_active.
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			// tx 已经 abort, 任何后续 tx-bound query 都会失败.
			// rollback 当前 tx, 用 pool 重新 lookup.
			_ = tx.Rollback(ctx)
			existing, lookupErr := r.findBySignalActiveNoTx(ctx, in.UserID, in.PrimarySignalID)
			if lookupErr != nil {
				return nil, fmt.Errorf("race detected, lookup failed: %w", lookupErr)
			}
			return existing, nil
		}
		return nil, fmt.Errorf("insert session: %w", err)
	}

	// 3) outbox
	if err := insertOutbox(ctx, tx, eventID, domain.EventRefinementStarted, payloadBytes); err != nil {
		return nil, err
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &Session{
		ID:              in.SessionID,
		UserID:          in.UserID,
		PrimarySignalID: in.PrimarySignalID,
		PrimaryAsset:    in.PrimaryAsset,
		Status:          "active",
		RoundsDone:      0,
		StartedAt:       now,
		UpdatedAt:       now,
	}, nil
}

// ───── RecordAnswer ─────

type AnswerInput struct {
	UserID        uuid.UUID
	ClientEventID uuid.UUID
	SessionID     uuid.UUID
	Round         int // 1..5
	QuestionID    string
	QuestionKind  domain.QuestionKind
	QuestionText  string
	Options       []domain.QuestionOption
	Answer        domain.UserAnswer
	Diagnosis     domain.AnswerDiagnosis
}

type AnswerResult struct {
	EventID   int64
	NewRound  int
	Completed bool
	Decision  *domain.RefinementDecision
}

// RecordAnswer 写 refinement.answered event + 更新 sessions.rounds_done.
// 第 5 轮答完时, 同事务里再写 refinement.completed + status=completed.
func (r *Repository) RecordAnswer(ctx context.Context, in AnswerInput) (*AnswerResult, error) {
	now := time.Now().UTC()
	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// 锁住 sessions 行以防并发递增 rounds_done
	const lockSession = `
		SELECT user_id, status, rounds_done FROM refinement_sessions
		WHERE id = $1 FOR UPDATE
	`
	var (
		ownerID    uuid.UUID
		status     string
		roundsDone int
	)
	if err := tx.QueryRow(ctx, lockSession, in.SessionID).Scan(&ownerID, &status, &roundsDone); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("lock session: %w", err)
	}
	if ownerID != in.UserID {
		return nil, ErrNotFound // 不暴露存在性
	}
	if status != "active" {
		return nil, ErrAlreadyClosed
	}
	if in.Round != roundsDone+1 {
		return nil, fmt.Errorf("%w: expected round %d, got %d", ErrInvalidRound, roundsDone+1, in.Round)
	}

	// 1) events.refinement.answered
	answerPayload := domain.RefinementAnsweredPayload{
		RefinementID: in.SessionID,
		UserID:       in.UserID,
		Round:        in.Round,
		QuestionID:   in.QuestionID,
		QuestionKind: in.QuestionKind,
		QuestionText: in.QuestionText,
		Options:      in.Options,
		Answer:       in.Answer,
		Diagnosis:    in.Diagnosis,
		AnsweredAt:   now,
	}
	answerBytes, err := json.Marshal(answerPayload)
	if err != nil {
		return nil, fmt.Errorf("marshal answer payload: %w", err)
	}

	const insertAnswerEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertAnswerEvent,
		in.UserID, in.ClientEventID, string(domain.EventRefinementAnswered), answerBytes, now,
	).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// duplicate event — silently treat as success (idempotent).
			if err := tx.Commit(ctx); err != nil {
				return nil, fmt.Errorf("commit (dup answer): %w", err)
			}
			return &AnswerResult{NewRound: roundsDone, Completed: status == "completed"}, nil
		}
		return nil, fmt.Errorf("insert answer event: %w", err)
	}

	// 2) sessions update rounds_done
	const updateSession = `
		UPDATE refinement_sessions
			SET rounds_done = $1, updated_at = $2
		WHERE id = $3
	`
	if _, err := tx.Exec(ctx, updateSession, in.Round, now, in.SessionID); err != nil {
		return nil, fmt.Errorf("update session: %w", err)
	}

	// 3) outbox for answered
	if err := insertOutbox(ctx, tx, eventID, domain.EventRefinementAnswered, answerBytes); err != nil {
		return nil, err
	}

	result := &AnswerResult{EventID: eventID, NewRound: in.Round, Completed: false}

	// 4) 第 5 轮答完 → 同事务写 refinement.completed
	if in.Round == 5 {
		decision := domain.RefinementEligibleForGate
		// Phase 2 启发式: 第 1, 3, 5 轮的诊断都是 weak/distractor 占多数, 改 training_only.
		// 这里简化为默认 eligible_for_gate; M5 后期 prompt 调好后再优化判定.
		completedPayload := domain.RefinementCompletedPayload{
			RefinementID: in.SessionID,
			UserID:       in.UserID,
			RoundsDone:   5,
			EndedEarly:   false,
			Decision:     decision,
			EndedAt:      now,
		}
		completedBytes, err := json.Marshal(completedPayload)
		if err != nil {
			return nil, fmt.Errorf("marshal completed payload: %w", err)
		}

		// completed event 用 sessionID 派生的 client_event_id 防重
		completedCID := uuid.NewSHA1(uuid.NameSpaceOID,
			append([]byte("refinement-completed:"), in.SessionID[:]...))

		var completedEventID int64
		if err := tx.QueryRow(ctx, insertAnswerEvent,
			in.UserID, completedCID, string(domain.EventRefinementCompleted), completedBytes, now,
		).Scan(&completedEventID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("insert completed event: %w", err)
		}

		const closeSession = `
			UPDATE refinement_sessions
				SET status = 'completed', decision = $1, completed_at = $2, updated_at = $2
			WHERE id = $3
		`
		if _, err := tx.Exec(ctx, closeSession, string(decision), now, in.SessionID); err != nil {
			return nil, fmt.Errorf("close session: %w", err)
		}

		if completedEventID > 0 {
			if err := insertOutbox(ctx, tx, completedEventID, domain.EventRefinementCompleted, completedBytes); err != nil {
				return nil, err
			}
		}

		result.Completed = true
		result.Decision = &decision
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}
	return result, nil
}

// ───── List ─────

// List 返回该用户的全部 refinement 会话 (新→旧), 带 signal 摘要供列表展示.
// 不含 rounds (详情走 Get 拉) 也不查 project guidance (列表不需要, 省带宽).
func (r *Repository) List(ctx context.Context, userID uuid.UUID, limit int) ([]Session, error) {
	if limit <= 0 || limit > 200 {
		limit = 50
	}
	const q = `
		SELECT rs.id, rs.user_id, rs.primary_signal_id, rs.primary_asset, rs.status, rs.rounds_done,
		       rs.decision, rs.started_at, rs.completed_at, rs.updated_at,
		       s.raw_text, s.inference_summary,
		       p.name
		FROM refinement_sessions rs
		JOIN signals s ON s.id = rs.primary_signal_id
		LEFT JOIN projects p ON p.id = s.project_id
		WHERE rs.user_id = $1
		ORDER BY rs.started_at DESC
		LIMIT $2
	`
	rows, err := r.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list sessions: %w", err)
	}
	defer rows.Close()

	var out []Session
	for rows.Next() {
		var s Session
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.PrimarySignalID, &s.PrimaryAsset, &s.Status, &s.RoundsDone,
			&s.Decision, &s.StartedAt, &s.CompletedAt, &s.UpdatedAt,
			&s.PrimarySignalRawText, &s.PrimarySignalSummary,
			&s.ProjectName,
		); err != nil {
			return nil, fmt.Errorf("scan session: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ───── Get ─────

// GetLatestCompletedBySignal 返回该 signal 上最近一次已完成 (status='completed')
// 的五轮追问完整视图. 用于信号详情页底部回看历史问答.
// 没有已完成的 session 时返回 ErrNotFound (不暴露 abandoned/active 给详情页).
func (r *Repository) GetLatestCompletedBySignal(ctx context.Context, userID, signalID uuid.UUID) (*SessionView, error) {
	const q = `
		SELECT id FROM refinement_sessions
		WHERE user_id = $1 AND primary_signal_id = $2 AND status = 'completed'
		ORDER BY completed_at DESC NULLS LAST
		LIMIT 1
	`
	var sessionID uuid.UUID
	if err := r.pool.QueryRow(ctx, q, userID, signalID).Scan(&sessionID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("lookup latest completed session: %w", err)
	}
	return r.Get(ctx, userID, sessionID)
}

// Get returns session head + all answered rounds + the pending question (if any)
// + 用户最新 training_focus (M11.5 闭环).
func (r *Repository) Get(ctx context.Context, userID, id uuid.UUID) (*SessionView, error) {
	session, err := r.getSession(ctx, userID, id)
	if err != nil {
		return nil, err
	}

	rounds, err := r.listRounds(ctx, id)
	if err != nil {
		return nil, err
	}

	pendingQ, err := r.loadPendingQuestion(ctx, id, session.RoundsDone+1)
	if err != nil {
		return nil, err
	}

	focusDim, focusText := r.loadLatestTrainingFocus(ctx, userID)

	return &SessionView{
		Session:           *session,
		Rounds:            rounds,
		Question:          pendingQ,
		TrainingFocusDim:  focusDim,
		TrainingFocusText: focusText,
	}, nil
}

// loadLatestTrainingFocus 拉用户最新一条 training_focus. 没有 (新用户) 时返回空.
// 不报错 — 缺训练重点不是错误状态.
func (r *Repository) loadLatestTrainingFocus(ctx context.Context, userID uuid.UUID) (string, string) {
	const q = `SELECT training_focuses FROM user_training_state WHERE user_id = $1`
	var raw []byte
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&raw); err != nil {
		return "", ""
	}
	var focuses []map[string]any
	if err := json.Unmarshal(raw, &focuses); err != nil {
		return "", ""
	}
	if len(focuses) == 0 {
		return "", ""
	}
	first := focuses[0]
	dim, _ := first["focus_dim"].(string)
	text, _ := first["focus_text"].(string)
	return dim, text
}

func (r *Repository) getSession(ctx context.Context, userID, id uuid.UUID) (*Session, error) {
	const q = `
		SELECT rs.id, rs.user_id, rs.primary_signal_id, rs.primary_asset, rs.status, rs.rounds_done,
		       rs.decision, rs.started_at, rs.completed_at, rs.updated_at,
		       s.raw_text, s.inference_summary,
		       s.inference_tags, s.inference_related_assets,
		       p.name, p.guidance,
		       u.language
		FROM refinement_sessions rs
		JOIN signals s ON s.id = rs.primary_signal_id
		LEFT JOIN projects p ON p.id = s.project_id
		JOIN users u ON u.id = rs.user_id
		WHERE rs.user_id = $1 AND rs.id = $2
	`
	var s Session
	if err := r.pool.QueryRow(ctx, q, userID, id).Scan(
		&s.ID, &s.UserID, &s.PrimarySignalID, &s.PrimaryAsset, &s.Status, &s.RoundsDone,
		&s.Decision, &s.StartedAt, &s.CompletedAt, &s.UpdatedAt,
		&s.PrimarySignalRawText, &s.PrimarySignalSummary,
		&s.PrimarySignalTags, &s.PrimarySignalRelatedAssets,
		&s.ProjectName, &s.ProjectGuidance,
		&s.Language,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get session: %w", err)
	}
	return &s, nil
}

func (r *Repository) listRounds(ctx context.Context, sessionID uuid.UUID) ([]Round, error) {
	// 从 events.refinement.answered 拉出, 按 round 顺序
	const q = `
		SELECT payload
		FROM events
		WHERE type = $1
		  AND (payload->>'refinement_id')::uuid = $2
		ORDER BY (payload->>'round')::int ASC
	`
	rows, err := r.pool.Query(ctx, q, string(domain.EventRefinementAnswered), sessionID)
	if err != nil {
		return nil, fmt.Errorf("query rounds: %w", err)
	}
	defer rows.Close()

	out := make([]Round, 0, 5)
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan round: %w", err)
		}
		var p domain.RefinementAnsweredPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, fmt.Errorf("unmarshal answered payload: %w", err)
		}
		out = append(out, Round{
			Round:        p.Round,
			QuestionID:   p.QuestionID,
			QuestionKind: p.QuestionKind,
			QuestionText: p.QuestionText,
			Options:      p.Options,
			Answer:       p.Answer,
			Diagnosis:    p.Diagnosis,
			AnsweredAt:   p.AnsweredAt,
		})
	}
	return out, rows.Err()
}

func (r *Repository) loadPendingQuestion(ctx context.Context, sessionID uuid.UUID, round int) (*Question, error) {
	const q = `SELECT payload FROM refinement_questions WHERE session_id = $1 AND round = $2`
	var raw json.RawMessage
	if err := r.pool.QueryRow(ctx, q, sessionID, round).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("load pending question: %w", err)
	}
	return &Question{Round: round, Payload: raw}, nil
}

// ───── SaveQuestion (internal API, Mastra calls this) ─────

type SaveQuestionInput struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Round     int
	Payload   json.RawMessage
}

// SaveQuestion upserts 题目缓存. 同一 (session, round) 多次 POST 取最后一次.
// 校验: session 属于该 userID, round 必须 = rounds_done + 1 (不能提前出题).
func (r *Repository) SaveQuestion(ctx context.Context, in SaveQuestionInput) error {
	const verify = `
		SELECT rounds_done, status FROM refinement_sessions WHERE id = $1 AND user_id = $2
	`
	var (
		roundsDone int
		status     string
	)
	if err := r.pool.QueryRow(ctx, verify, in.SessionID, in.UserID).Scan(&roundsDone, &status); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return ErrNotFound
		}
		return fmt.Errorf("verify session: %w", err)
	}
	if status != "active" {
		return ErrAlreadyClosed
	}
	if in.Round != roundsDone+1 {
		return fmt.Errorf("%w: cannot save question for round %d (rounds_done=%d)", ErrInvalidRound, in.Round, roundsDone)
	}

	const upsert = `
		INSERT INTO refinement_questions (session_id, round, payload, created_at, updated_at)
		VALUES ($1, $2, $3, NOW(), NOW())
		ON CONFLICT (session_id, round) DO UPDATE
			SET payload = EXCLUDED.payload, updated_at = NOW()
	`
	if _, err := r.pool.Exec(ctx, upsert, in.SessionID, in.Round, in.Payload); err != nil {
		return fmt.Errorf("upsert question: %w", err)
	}
	return nil
}

// ───── helpers ─────

func (r *Repository) findBySignalActive(ctx context.Context, tx pgx.Tx, userID, signalID uuid.UUID) (*Session, error) {
	const q = `
		SELECT id, user_id, primary_signal_id, primary_asset, status, rounds_done,
		       decision, started_at, completed_at, updated_at
		FROM refinement_sessions
		WHERE user_id = $1 AND primary_signal_id = $2 AND status = 'active'
		LIMIT 1
	`
	var s Session
	if err := tx.QueryRow(ctx, q, userID, signalID).Scan(
		&s.ID, &s.UserID, &s.PrimarySignalID, &s.PrimaryAsset, &s.Status, &s.RoundsDone,
		&s.Decision, &s.StartedAt, &s.CompletedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &s, nil
}

// EnqueueReinferQuestionOutbox — 用户主动触发: refinement 卡在"等下一题"
// (上一条 refinement.answered 被 mastra socratic DLQ 了), 重发同一条 event
// 给 NATS, 让 mastra 重新跑出题流程.
//
// 行为: 找该 session 最近一条 refinement.answered event, 写一行新 outbox
// (复用同 event_id + payload). 不新建 event — 事件溯源不污染.
//
// 失败语义:
//   - session 没有 refinement.answered (用户还没答任何一轮) → return error,
//     调用方应该走 reinfer-started 路径 (M5 R1 出题失败). 暂未实现, 当前 v1
//     用户场景就是 R2+ 卡住.
func (r *Repository) EnqueueReinferQuestionOutbox(ctx context.Context, sessionID uuid.UUID) error {
	const q = `
		SELECT id, payload
		FROM events
		WHERE type = $1
		  AND (payload->>'refinement_id')::uuid = $2
		ORDER BY occurred_at DESC
		LIMIT 1
	`
	var eventID int64
	var payload []byte
	if err := r.pool.QueryRow(ctx, q, string(domain.EventRefinementAnswered), sessionID).Scan(&eventID, &payload); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return fmt.Errorf("no refinement.answered event for session %s", sessionID)
		}
		return fmt.Errorf("lookup answered event: %w", err)
	}

	const insertQ = `
		INSERT INTO event_outbox (event_id, subject, payload)
		VALUES ($1, $2, $3)
	`
	if _, err := r.pool.Exec(ctx, insertQ,
		eventID, string(domain.EventRefinementAnswered), payload,
	); err != nil {
		return fmt.Errorf("insert reinfer-question outbox: %w", err)
	}
	return nil
}

// findBySignalActiveNoTx — Start 入口处的快路径, 不开 tx 直接查 pool.
// pgx.ErrNoRows 时调用方走 INSERT 路径; 其他 err 直接传上去.
func (r *Repository) findBySignalActiveNoTx(ctx context.Context, userID, signalID uuid.UUID) (*Session, error) {
	const q = `
		SELECT id, user_id, primary_signal_id, primary_asset, status, rounds_done,
		       decision, started_at, completed_at, updated_at
		FROM refinement_sessions
		WHERE user_id = $1 AND primary_signal_id = $2 AND status = 'active'
		LIMIT 1
	`
	var s Session
	if err := r.pool.QueryRow(ctx, q, userID, signalID).Scan(
		&s.ID, &s.UserID, &s.PrimarySignalID, &s.PrimaryAsset, &s.Status, &s.RoundsDone,
		&s.Decision, &s.StartedAt, &s.CompletedAt, &s.UpdatedAt,
	); err != nil {
		return nil, err
	}
	return &s, nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, eventID int64, et domain.EventType, payload []byte) error {
	const q = `INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)`
	if _, err := tx.Exec(ctx, q, eventID, string(et), payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}
