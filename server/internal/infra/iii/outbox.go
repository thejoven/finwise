package iii

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"wiseflow/server/internal/infra/db"
	"wiseflow/server/internal/infra/metrics"
)

// OutboxWorker drains event_outbox to the iii engine over HTTP.
// 与原 NATS 版本对等: SKIP LOCKED 安全, batch+poll 调优用同样 env.
type OutboxWorker struct {
	pool   *db.Pool
	client *Client
	logger *zap.Logger

	pollInterval time.Duration
	batchSize    int
	maxAttempts  int

	postPublish PostPublishFn
}

// PostPublishFn 在每条事件成功 POST 到 iii 后被调用 (在 tx 提交之后).
// 用来串本地后续动作 — 比如 refinement.completed 同步触发 gate.Evaluate.
// 错误只记日志, 不会回滚 outbox 状态.
type PostPublishFn func(ctx context.Context, subject string, payload []byte)

type OutboxConfig struct {
	PollInterval time.Duration
	BatchSize    int
	MaxAttempts  int
	PostPublish  PostPublishFn
}

func NewOutboxWorker(pool *db.Pool, client *Client, logger *zap.Logger, cfg OutboxConfig) *OutboxWorker {
	if cfg.PollInterval == 0 {
		cfg.PollInterval = 500 * time.Millisecond
	}
	if cfg.BatchSize == 0 {
		cfg.BatchSize = 10
	}
	if cfg.MaxAttempts == 0 {
		cfg.MaxAttempts = 5
	}
	return &OutboxWorker{
		pool:         pool,
		client:       client,
		logger:       logger,
		pollInterval: cfg.PollInterval,
		batchSize:    cfg.BatchSize,
		maxAttempts:  cfg.MaxAttempts,
		postPublish:  cfg.PostPublish,
	}
}

func (w *OutboxWorker) Run(ctx context.Context) {
	w.logger.Info("outbox worker started (iii)",
		zap.Duration("poll", w.pollInterval),
		zap.Int("batch", w.batchSize),
	)
	tick := time.NewTicker(w.pollInterval)
	defer tick.Stop()
	for {
		select {
		case <-ctx.Done():
			w.logger.Info("outbox worker stopped")
			return
		case <-tick.C:
			if n, err := w.drainOnce(ctx); err != nil {
				w.logger.Error("outbox drain", zap.Error(err))
			} else if n > 0 {
				w.logger.Debug("outbox drained", zap.Int("count", n))
			}
		}
	}
}

func (w *OutboxWorker) drainOnce(ctx context.Context) (int, error) {
	tx, err := w.pool.BeginTx(ctx, pgx.TxOptions{})
	if err != nil {
		return 0, fmt.Errorf("begin tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	const selectPending = `
		SELECT id, event_id, subject, payload, publish_attempts
		FROM event_outbox
		WHERE published_at IS NULL
		  AND publish_attempts < $1
		ORDER BY enqueued_at
		LIMIT $2
		FOR UPDATE SKIP LOCKED
	`
	rows, err := tx.Query(ctx, selectPending, w.maxAttempts, w.batchSize)
	if err != nil {
		return 0, fmt.Errorf("select pending: %w", err)
	}

	type pending struct {
		id       int64
		eventID  int64
		subject  string
		payload  []byte
		attempts int
	}
	var batch []pending
	for rows.Next() {
		var p pending
		if err := rows.Scan(&p.id, &p.eventID, &p.subject, &p.payload, &p.attempts); err != nil {
			rows.Close()
			return 0, fmt.Errorf("scan pending: %w", err)
		}
		batch = append(batch, p)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("rows iter: %w", err)
	}
	if len(batch) == 0 {
		return 0, tx.Commit(ctx)
	}

	// 成功 dispatch 的事件 — 提交后再跑 postPublish.
	type successful struct {
		subject string
		payload []byte
	}
	var sent []successful

	published := 0
	for _, p := range batch {
		handled, pubErr := w.client.Publish(ctx, p.subject, p.payload)
		if pubErr != nil {
			metrics.OutboxFailed.Inc()
			w.logger.Warn("iii publish failed",
				zap.Int64("outbox_id", p.id),
				zap.String("subject", p.subject),
				zap.Int("attempts", p.attempts+1),
				zap.Error(pubErr),
			)
			_, err := tx.Exec(ctx, `
				UPDATE event_outbox
				   SET publish_attempts = publish_attempts + 1,
				       last_error       = $1
				 WHERE id = $2
			`, pubErr.Error(), p.id)
			if err != nil {
				return published, fmt.Errorf("mark failed: %w", err)
			}
			continue
		}
		metrics.OutboxPublished.Inc()
		_, err := tx.Exec(ctx, `
			UPDATE event_outbox
			   SET published_at     = NOW(),
			       publish_attempts = publish_attempts + 1,
			       last_error       = NULL
			 WHERE id = $1
		`, p.id)
		if err != nil {
			return published, fmt.Errorf("mark published: %w", err)
		}
		published++
		if handled {
			sent = append(sent, successful{subject: p.subject, payload: p.payload})
		}
	}

	if err := tx.Commit(ctx); err != nil {
		return published, fmt.Errorf("commit: %w", err)
	}

	if w.postPublish != nil {
		for _, s := range sent {
			w.postPublish(ctx, s.subject, s.payload)
		}
	}
	return published, nil
}
