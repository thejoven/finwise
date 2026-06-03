// Package exit is the M10 退出条件巡检 module.
//
// Phase 3 v1 范围 (time-only checker):
//   - 每 1 小时扫一遍所有 active/triggered 持仓
//   - 如果 NOW() >= expires_at:
//     · 写 events.exit.condition.checked (evaluator=time, result=hit)
//     · 写 events.exit.condition.triggered (condition_id=time-marker)
//     · 写 events.holding.state_changed (active → expired)
//     · UPDATE holdings.status = 'expired'
//     · outbox 发对应 subjects
//     · 触发 M11 retrospect 创建 (separate event flow)
//
// 不在 Phase 3 v1 范围:
//   - 价格触发 (需要市场数据源, M10 v2)
//   - 基本面触发 (财报 / 监管, M10 v2)
//   - 用户主动平仓 (UI 触发 close, 不归 cron 管)
package exit

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/infra/db"
	"wiseflow/server/internal/infra/metrics"
)

const (
	scanInterval = 1 * time.Hour
	// time-based condition 用一个固定 UUID 作 condition_id (single-condition time marker)
	timeConditionMarker = "00000000-0000-0000-0000-00000000T1ME"
)

// StartRetrospectFn 是 transition 后调的回调, 创建 pending retrospect.
// 用 func 而不是 interface 避免引 retrospect 包 (循环 import).
// retrospect 包模块在 main.go 装配时把闭包传进来.
type StartRetrospectFn func(ctx context.Context, userID, commitmentID uuid.UUID, trigger string) error

// Checker 周期性扫描 active holdings, 处理时间到期.
type Checker struct {
	pool           *db.Pool
	logger         *zap.Logger
	startRetrospect StartRetrospectFn
}

func NewChecker(pool *db.Pool, logger *zap.Logger, startRetrospect StartRetrospectFn) *Checker {
	return &Checker{pool: pool, logger: logger, startRetrospect: startRetrospect}
}

// Run blocks until ctx canceled. 每 scanInterval 扫一次.
// 启动时也立即扫一次, 避免 server 重启刚好错过到期时刻.
func (c *Checker) Run(ctx context.Context) {
	c.logger.Info("exit checker started", zap.Duration("interval", scanInterval))
	// 立即扫一次
	if err := c.scanOnce(ctx); err != nil {
		c.logger.Error("exit initial scan", zap.Error(err))
	}
	ticker := time.NewTicker(scanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			c.logger.Info("exit checker stopped")
			return
		case <-ticker.C:
			if err := c.scanOnce(ctx); err != nil {
				c.logger.Error("exit scan", zap.Error(err))
			}
		}
	}
}

// scanOnce 单次扫描. 查 NOW() >= expires_at AND status in (active, triggered).
func (c *Checker) scanOnce(ctx context.Context) error {
	start := time.Now()
	defer func() {
		metrics.ExitScanDuration.Observe(time.Since(start).Seconds())
	}()
	const q = `
		SELECT id, user_id, exit_conditions, expires_at, status
		FROM holdings
		WHERE status IN ('active', 'triggered')
		  AND expires_at <= NOW()
		LIMIT 100
	`
	rows, err := c.pool.Query(ctx, q)
	if err != nil {
		return fmt.Errorf("scan holdings: %w", err)
	}
	defer rows.Close()

	type hit struct {
		id         uuid.UUID
		userID     uuid.UUID
		conditions []string
		expiresAt  time.Time
		status     string
	}
	var hits []hit
	for rows.Next() {
		var (
			h           hit
			conditions  []byte
		)
		if err := rows.Scan(&h.id, &h.userID, &conditions, &h.expiresAt, &h.status); err != nil {
			return fmt.Errorf("scan row: %w", err)
		}
		_ = json.Unmarshal(conditions, &h.conditions)
		hits = append(hits, h)
	}
	if err := rows.Err(); err != nil {
		return err
	}

	for _, h := range hits {
		if err := c.handleExpired(ctx, h.id, h.userID, h.conditions, h.expiresAt, h.status); err != nil {
			c.logger.Warn("exit handle", zap.String("commitment_id", h.id.String()), zap.Error(err))
			continue
		}
		metrics.ExitTransitions.WithLabelValues("expired").Inc()
		c.logger.Info("exit transitioned",
			zap.String("commitment_id", h.id.String()),
			zap.String("from", h.status),
			zap.String("to", "expired"),
		)

		// transition 成功 → 自动 start retrospect (pending). idempotent 在 retrospect 内部.
		if c.startRetrospect != nil {
			if err := c.startRetrospect(ctx, h.userID, h.id, string(domain.RetrospectTriggerExpired)); err != nil {
				// retrospect 创建失败不回滚 state 迁移 (state 是事件, 不能撤回).
				// 仅 warn, 用户事后可以手动从 GET /v1/retrospects 找到 commitment_id 触发.
				c.logger.Warn("retrospect auto-start failed",
					zap.String("commitment_id", h.id.String()), zap.Error(err))
			} else {
				c.logger.Info("retrospect auto-started",
					zap.String("commitment_id", h.id.String()))
			}
		}
	}
	return nil
}

// handleExpired 处理一个到期 holding. 全部在一个事务里, idempotent.
func (c *Checker) handleExpired(ctx context.Context, holdingID, userID uuid.UUID, conditions []string, expiresAt time.Time, fromStatus string) error {
	tx, err := c.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback(ctx) }()

	now := time.Now().UTC()
	conditionID := uuid.NewSHA1(uuid.NameSpaceOID, []byte("time:"+holdingID.String()))

	// observed JSON
	observed, _ := json.Marshal(map[string]any{
		"evaluator":  "time",
		"expires_at": expiresAt.Format(time.RFC3339),
		"checked_at": now.Format(time.RFC3339),
	})

	// 1) exit.condition.checked event (audit trail, even if redundant with triggered)
	checkedPayload := domain.ExitConditionCheckedPayload{
		CommitmentID: holdingID,
		UserID:       userID,
		ConditionID:  conditionID,
		Evaluator:    domain.EvaluatorTime,
		Result:       domain.ExitCheckHit,
		Observed:     observed,
		CheckedAt:    now,
	}
	checkedBytes, _ := json.Marshal(checkedPayload)
	if err := insertEventWithOutbox(ctx, tx, userID,
		uuid.NewSHA1(uuid.NameSpaceOID, []byte("exit-checked:time:"+holdingID.String())),
		domain.EventExitConditionChecked, checkedBytes, now); err != nil {
		return err
	}

	// 2) exit.condition.triggered (idempotent: (commitment, condition))
	conditionText := "time-window expired"
	if len(conditions) > 0 {
		// 把所有 user exit conditions 拼在一起作为冗余 condition_text (M11 复盘看)
		conditionText = "time-window expired; user exit conditions: "
		for i, ec := range conditions {
			if i > 0 {
				conditionText += " | "
			}
			conditionText += ec
		}
	}
	triggeredPayload := domain.ExitConditionTriggeredPayload{
		CommitmentID:  holdingID,
		UserID:        userID,
		ConditionID:   conditionID,
		ConditionText: conditionText,
		Observed:      observed,
		TriggeredAt:   now,
	}
	triggeredBytes, _ := json.Marshal(triggeredPayload)
	if err := insertEventWithOutbox(ctx, tx, userID,
		uuid.NewSHA1(uuid.NameSpaceOID, []byte("exit-triggered:time:"+holdingID.String())),
		domain.EventExitConditionTriggered, triggeredBytes, now); err != nil {
		return err
	}

	// 3) holding.state_changed event
	changedPayload := domain.HoldingStateChangedPayload{
		CommitmentID: holdingID,
		UserID:       userID,
		From:         fromStatus,
		To:           "expired",
		Reason:       "time_window_expired",
		ChangedAt:    now,
	}
	changedBytes, _ := json.Marshal(changedPayload)
	if err := insertEventWithOutbox(ctx, tx, userID,
		uuid.NewSHA1(uuid.NameSpaceOID, []byte("holding-state:expired:"+holdingID.String())),
		domain.EventHoldingStateChanged, changedBytes, now); err != nil {
		return err
	}

	// 4) UPDATE holdings → expired (only if still active/triggered; CAS pattern)
	const updateHolding = `
		UPDATE holdings
			SET status = 'expired', updated_at = $1
		WHERE id = $2 AND status IN ('active', 'triggered')
	`
	tag, err := tx.Exec(ctx, updateHolding, now, holdingID)
	if err != nil {
		return fmt.Errorf("update holding: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// 已经被别的 scanner 抢先处理了 — 回滚, 不重复发事件
		return errors.New("holding already transitioned")
	}

	return tx.Commit(ctx)
}

func insertEventWithOutbox(ctx context.Context, tx pgx.Tx, userID, clientEventID uuid.UUID, et domain.EventType, payload []byte, occurredAt time.Time) error {
	const insertEvent = `
		INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		VALUES ($1, $2, $3, $4, $5)
		ON CONFLICT (user_id, client_event_id) DO NOTHING
		RETURNING id
	`
	var eventID int64
	if err := tx.QueryRow(ctx, insertEvent, userID, clientEventID, string(et), payload, occurredAt).Scan(&eventID); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			// 重复 — 这条事件已经写过, 不再 outbox, idempotent.
			return nil
		}
		return fmt.Errorf("insert event %s: %w", et, err)
	}
	const insertOutbox = `INSERT INTO event_outbox (event_id, subject, payload) VALUES ($1, $2, $3)`
	if _, err := tx.Exec(ctx, insertOutbox, eventID, string(et), payload); err != nil {
		return fmt.Errorf("insert outbox %s: %w", et, err)
	}
	return nil
}
