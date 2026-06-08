// Package gate is the M6 投决会 (四位分析师) 评估 module.
//
// 评估主体是 Go 编排, 四位分析师 (G1 厚度 / G2 共识 / G3 时机 / G4 能力圈) 的判断
// 都由 LLM (Mastra agent) 给出 (ADR 0005); Mastra 不可用 / 超时才回退启发式兜底.
//
// 数据流:
//
//	用户在降噪页手动触发 POST /v1/gate/evaluate ("前置于投决会", 见 cmd/api/main.go)
//	→ Service.EvaluateDetached → Evaluate(refinementID)
//	→ 四位分析师 sync.WaitGroup 并行审核 (见 service.go, 非串行)
//	→ 任一位否决立即 ArchiveSilently (写 gate.archived event, 但不在 client 可见 subject 发)
//	→ 全票过会 PassAndPromote (写 gate.evaluated + gate.passed; gate.passed 经 outbox → iii
//	  commitment-draft 队列, 由 M7 narrator 生成承诺书草稿)
package gate

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

var (
	ErrNotFound = errors.New("gate evaluation not found")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Evaluation mirrors a gate_evaluations row.
type Evaluation struct {
	ID           uuid.UUID
	UserID       uuid.UUID
	RefinementID uuid.UUID
	Gates        domain.GateDetail
	Passed       bool
	FailedGate   *int
	ArchivedPool *domain.ArchivePool
	EvaluatedAt  time.Time
}

// ───── Insert (transactional: event + view + outbox) ─────

type InsertInput struct {
	UserID       uuid.UUID
	RefinementID uuid.UUID
	Gates        domain.GateDetail
	Passed       bool
	FailedGate   *int
	ArchivedPool *domain.ArchivePool
	// HumanReason 仅 archived 时有意义 — 写到 gate.archived 事件的 payload.
	HumanReason string
}

// Insert 写一条完整 evaluation. 内部用一个事务保证:
//   - events.gate.evaluated (总是写)
//   - events.gate.archived  (仅 !Passed 时写, causation = gate.evaluated)
//   - gate_evaluations row
//   - outbox: gate.evaluated 总发; gate.archived 仅失败时发 (subject 客户端不订阅);
//     gate.passed 仅通过时发 (M7 narrator 消费)
func (r *Repository) Insert(ctx context.Context, in InsertInput) (*Evaluation, error) {
	now := time.Now().UTC()
	evalID := uuid.New()

	// gate.evaluated 全量 payload
	evalPayload := domain.GateEvaluatedPayload{
		EvaluationID: evalID,
		UserID:       in.UserID,
		RefinementID: in.RefinementID,
		Gates:        in.Gates,
		Passed:       in.Passed,
		FailedGate:   in.FailedGate,
		ArchivedPool: in.ArchivedPool,
		EvaluatedAt:  now,
	}
	evalBytes, err := json.Marshal(evalPayload)
	if err != nil {
		return nil, fmt.Errorf("marshal evaluated payload: %w", err)
	}

	tx, err := r.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return nil, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// client_event_id 由 (refinement_id + "evaluated") 派生, 防止重复触发产生多条
	evalCID := uuid.NewSHA1(uuid.NameSpaceOID,
		append([]byte("gate-evaluated:"), in.RefinementID[:]...))

	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var evalEventID int64
	if err := tx.QueryRow(ctx, insertEvent,
		in.UserID, evalCID, string(domain.EventGateEvaluated), evalBytes, now,
	).Scan(&evalEventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 已经 evaluate 过 — 静默成功, 返回已存在的
			return r.getByRefinement(ctx, tx, in.UserID, in.RefinementID)
		}
		return nil, fmt.Errorf("insert evaluated event: %w", err)
	}

	// 2) gate_evaluations row
	const insertView = `
		INSERT INTO gate_evaluations
			(id, user_id, refinement_id, gates_detail, passed, failed_gate, archived_pool, evaluated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
	`
	gatesJSON, err := json.Marshal(in.Gates)
	if err != nil {
		return nil, fmt.Errorf("marshal gates_detail: %w", err)
	}
	var pool *string
	if in.ArchivedPool != nil {
		s := string(*in.ArchivedPool)
		pool = &s
	}
	if _, err := tx.Exec(ctx, insertView,
		evalID, in.UserID, in.RefinementID, gatesJSON, in.Passed, in.FailedGate, pool, now,
	); err != nil {
		return nil, fmt.Errorf("insert gate_evaluations: %w", err)
	}

	// 3) outbox · gate.evaluated (审计用, 客户端不订阅)
	if err := insertOutbox(ctx, tx, evalEventID, domain.EventGateEvaluated, evalBytes); err != nil {
		return nil, err
	}

	// 4) 如果失败, 写 gate.archived event + outbox (subject 客户端不订阅, 沉默归档)
	if !in.Passed && in.ArchivedPool != nil && in.FailedGate != nil {
		archivedPayload := domain.GateArchivedPayload{
			EvaluationID: evalID,
			UserID:       in.UserID,
			Pool:         *in.ArchivedPool,
			FailedGate:   *in.FailedGate,
			HumanReason:  in.HumanReason,
			ArchivedAt:   now,
		}
		archivedBytes, err := json.Marshal(archivedPayload)
		if err != nil {
			return nil, fmt.Errorf("marshal archived payload: %w", err)
		}
		archivedCID := uuid.NewSHA1(uuid.NameSpaceOID,
			append([]byte("gate-archived:"), in.RefinementID[:]...))
		var archivedEventID int64
		if err := tx.QueryRow(ctx, insertEvent,
			in.UserID, archivedCID, string(domain.EventGateArchived), archivedBytes, now,
		).Scan(&archivedEventID); err != nil && !errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("insert archived event: %w", err)
		}
		if archivedEventID > 0 {
			if err := insertOutbox(ctx, tx, archivedEventID, domain.EventGateArchived, archivedBytes); err != nil {
				return nil, err
			}
		}
	}

	// 5) 如果通过, 发独立的 gate.passed (M7 narrator 消费)
	if in.Passed {
		// gate.passed 不是单独的 EventType — 它是 outbox-only 信号, 同样 payload
		// 用 evaluated payload, 但 subject = "gate.passed"
		const insertOutboxPassed = `
			INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)
		`
		if _, err := tx.Exec(ctx, insertOutboxPassed, evalEventID, "gate.passed", evalBytes); err != nil {
			return nil, fmt.Errorf("insert outbox passed: %w", err)
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit: %w", err)
	}

	return &Evaluation{
		ID:           evalID,
		UserID:       in.UserID,
		RefinementID: in.RefinementID,
		Gates:        in.Gates,
		Passed:       in.Passed,
		FailedGate:   in.FailedGate,
		ArchivedPool: in.ArchivedPool,
		EvaluatedAt:  now,
	}, nil
}

// ───── reads ─────

func (r *Repository) GetByID(ctx context.Context, userID, id uuid.UUID) (*Evaluation, error) {
	const q = `
		SELECT id, user_id, refinement_id, gates_detail, passed, failed_gate, archived_pool, evaluated_at
		FROM gate_evaluations WHERE user_id = $1 AND id = $2
	`
	var (
		ev    Evaluation
		gates json.RawMessage
		pool  *string
	)
	if err := r.pool.QueryRow(ctx, q, userID, id).Scan(
		&ev.ID, &ev.UserID, &ev.RefinementID, &gates, &ev.Passed, &ev.FailedGate, &pool, &ev.EvaluatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get evaluation: %w", err)
	}
	if err := json.Unmarshal(gates, &ev.Gates); err != nil {
		return nil, fmt.Errorf("unmarshal gates_detail: %w", err)
	}
	if pool != nil {
		p := domain.ArchivePool(*pool)
		ev.ArchivedPool = &p
	}
	return &ev, nil
}

// GetByRefinementID 按 refinement_id 拿用户的 evaluation. 客户端 signal 详情页用,
// 把"过会 / 哪位分析师否决"的结果展示在信号底部. 没有 → ErrNotFound.
func (r *Repository) GetByRefinementID(ctx context.Context, userID, refinementID uuid.UUID) (*Evaluation, error) {
	const q = `
		SELECT id, user_id, refinement_id, gates_detail, passed, failed_gate, archived_pool, evaluated_at
		FROM gate_evaluations WHERE user_id = $1 AND refinement_id = $2
	`
	var (
		ev    Evaluation
		gates json.RawMessage
		pool  *string
	)
	if err := r.pool.QueryRow(ctx, q, userID, refinementID).Scan(
		&ev.ID, &ev.UserID, &ev.RefinementID, &gates, &ev.Passed, &ev.FailedGate, &pool, &ev.EvaluatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get by refinement: %w", err)
	}
	if err := json.Unmarshal(gates, &ev.Gates); err != nil {
		return nil, fmt.Errorf("unmarshal gates_detail: %w", err)
	}
	if pool != nil {
		p := domain.ArchivePool(*pool)
		ev.ArchivedPool = &p
	}
	return &ev, nil
}

func (r *Repository) ListByPool(ctx context.Context, userID uuid.UUID, pool domain.ArchivePool, limit int, projectID *uuid.UUID) ([]Evaluation, error) {
	if limit <= 0 || limit > 100 {
		limit = 50
	}
	// 过滤分类时 JOIN 回 signals (project_id 真相只挂在 signals 上). projectID==nil
	// 时不 JOIN, 查询与原来等价.
	q := `
		SELECT ge.id, ge.user_id, ge.refinement_id, ge.gates_detail, ge.passed, ge.failed_gate, ge.archived_pool, ge.evaluated_at
		FROM gate_evaluations ge`
	where := " WHERE ge.user_id = $1 AND ge.archived_pool = $2"
	args := []any{userID, string(pool)}
	if projectID != nil {
		q += " JOIN refinement_sessions rs ON rs.id = ge.refinement_id JOIN signals s ON s.id = rs.primary_signal_id"
		args = append(args, *projectID)
		where += fmt.Sprintf(" AND s.project_id = $%d", len(args))
	}
	args = append(args, limit)
	q += where + fmt.Sprintf(" ORDER BY ge.evaluated_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("list by pool: %w", err)
	}
	defer rows.Close()
	out := make([]Evaluation, 0, limit)
	for rows.Next() {
		var (
			ev    Evaluation
			gates json.RawMessage
			p     *string
		)
		if err := rows.Scan(&ev.ID, &ev.UserID, &ev.RefinementID, &gates, &ev.Passed, &ev.FailedGate, &p, &ev.EvaluatedAt); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		if err := json.Unmarshal(gates, &ev.Gates); err != nil {
			return nil, fmt.Errorf("unmarshal: %w", err)
		}
		if p != nil {
			ap := domain.ArchivePool(*p)
			ev.ArchivedPool = &ap
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

// ListAll 返回该用户全部评估 (新→旧), 含 passed (archived_pool=NULL, 不在任何 pool).
// web-admin "分析师评审" 页统一列表用 — pool 列表看不到 passed 的.
func (r *Repository) ListAll(ctx context.Context, userID uuid.UUID, limit int) ([]Evaluation, error) {
	if limit <= 0 || limit > 200 {
		limit = 100
	}
	const q = `
		SELECT ge.id, ge.user_id, ge.refinement_id, ge.gates_detail, ge.passed, ge.failed_gate, ge.archived_pool, ge.evaluated_at
		FROM gate_evaluations ge
		WHERE ge.user_id = $1
		ORDER BY ge.evaluated_at DESC
		LIMIT $2
	`
	rows, err := r.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("list all: %w", err)
	}
	defer rows.Close()
	out := make([]Evaluation, 0, limit)
	for rows.Next() {
		var (
			ev    Evaluation
			gates json.RawMessage
			p     *string
		)
		if err := rows.Scan(&ev.ID, &ev.UserID, &ev.RefinementID, &gates, &ev.Passed, &ev.FailedGate, &p, &ev.EvaluatedAt); err != nil {
			return nil, fmt.Errorf("scan: %w", err)
		}
		if err := json.Unmarshal(gates, &ev.Gates); err != nil {
			return nil, fmt.Errorf("unmarshal: %w", err)
		}
		if p != nil {
			ap := domain.ArchivePool(*p)
			ev.ArchivedPool = &ap
		}
		out = append(out, ev)
	}
	return out, rows.Err()
}

func (r *Repository) getByRefinement(ctx context.Context, tx pgx.Tx, userID, refinementID uuid.UUID) (*Evaluation, error) {
	const q = `
		SELECT id, user_id, refinement_id, gates_detail, passed, failed_gate, archived_pool, evaluated_at
		FROM gate_evaluations WHERE user_id = $1 AND refinement_id = $2
	`
	var (
		ev    Evaluation
		gates json.RawMessage
		pool  *string
	)
	if err := tx.QueryRow(ctx, q, userID, refinementID).Scan(
		&ev.ID, &ev.UserID, &ev.RefinementID, &gates, &ev.Passed, &ev.FailedGate, &pool, &ev.EvaluatedAt,
	); err != nil {
		return nil, fmt.Errorf("get by refinement: %w", err)
	}
	if err := json.Unmarshal(gates, &ev.Gates); err != nil {
		return nil, err
	}
	if pool != nil {
		p := domain.ArchivePool(*pool)
		ev.ArchivedPool = &p
	}
	return &ev, nil
}

func insertOutbox(ctx context.Context, tx pgx.Tx, eventID int64, et domain.EventType, payload []byte) error {
	const q = `INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)`
	if _, err := tx.Exec(ctx, q, eventID, string(et), payload); err != nil {
		return fmt.Errorf("insert outbox: %w", err)
	}
	return nil
}
