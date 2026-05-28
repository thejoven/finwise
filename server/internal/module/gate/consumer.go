package gate

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	natsgo "github.com/nats-io/nats.go"
	"go.uber.org/zap"

	"flashfi/server/internal/domain"
	"flashfi/server/internal/infra/metrics"
	natsx "flashfi/server/internal/infra/nats"
)

// Consumer 订阅 refinement.completed 触发 gate.Service.Evaluate.
// 单进程跑一个就够 (durable + pull-based 让重启不丢消息).
type Consumer struct {
	svc    *Service
	client *natsx.Client
	logger *zap.Logger

	maxAttempts int
	ackWait     time.Duration
}

func NewConsumer(svc *Service, client *natsx.Client, logger *zap.Logger) *Consumer {
	return &Consumer{
		svc:         svc,
		client:      client,
		logger:      logger,
		maxAttempts: 3,
		ackWait:     90 * time.Second, // gate eval 可能 5-10s (LLM 接入后), 留 buffer
	}
}

// Run blocks until ctx is canceled.
// Pull-based consumer: 与 Mastra 的 push consumer 隔离, 不抢消息.
func (c *Consumer) Run(ctx context.Context) {
	const (
		subject = "refinement.completed"
		durable = "gate-evaluator"
	)
	// Pull-based consumer
	sub, err := c.client.JS.PullSubscribe(subject, durable,
		natsgo.AckExplicit(),
		natsgo.AckWait(c.ackWait),
		natsgo.MaxDeliver(c.maxAttempts),
		natsgo.DeliverNew(),
	)
	if err != nil {
		c.logger.Error("gate consumer subscribe", zap.Error(err))
		return
	}
	defer func() { _ = sub.Unsubscribe() }()

	c.logger.Info("gate consumer started", zap.String("subject", subject), zap.String("durable", durable))

	for {
		select {
		case <-ctx.Done():
			c.logger.Info("gate consumer stopped")
			return
		default:
		}

		msgs, err := sub.Fetch(1, natsgo.MaxWait(5*time.Second))
		if err != nil {
			// 超时正常 — 没消息. 继续 loop.
			if err == natsgo.ErrTimeout {
				continue
			}
			c.logger.Warn("gate fetch", zap.Error(err))
			time.Sleep(time.Second)
			continue
		}
		for _, msg := range msgs {
			c.handle(ctx, msg)
		}
	}
}

func (c *Consumer) handle(ctx context.Context, msg *natsgo.Msg) {
	md, _ := msg.Metadata()
	deliveries := int64(0)
	if md != nil {
		deliveries = int64(md.NumDelivered)
	}

	var payload domain.RefinementCompletedPayload
	if err := json.Unmarshal(msg.Data, &payload); err != nil {
		c.logger.Error("gate decode payload", zap.Error(err))
		_ = msg.Term() // 不可恢复
		return
	}

	if payload.Decision == domain.RefinementTrainingOnly {
		c.logger.Info("gate skipped (training_only)",
			zap.String("refinement_id", payload.RefinementID.String()))
		_ = msg.Ack()
		return
	}

	start := time.Now()
	ev, err := c.svc.Evaluate(ctx, payload.RefinementID)
	dur := time.Since(start)
	metrics.GateDuration.Observe(dur.Seconds())

	if err != nil {
		c.logger.Warn("gate evaluate failed",
			zap.String("refinement_id", payload.RefinementID.String()),
			zap.Int64("deliveries", deliveries),
			zap.Error(err),
		)
		if deliveries >= int64(c.maxAttempts) {
			c.logger.Error("gate DLQ (max retries)",
				zap.String("refinement_id", payload.RefinementID.String()),
				zap.Error(err),
			)
			_ = msg.Term()
			return
		}
		_ = msg.Nak()
		return
	}

	outcome := "passed"
	pool := "none"
	if !ev.Passed {
		outcome = "failed"
		if ev.ArchivedPool != nil {
			pool = string(*ev.ArchivedPool)
		}
	}
	metrics.GateEvaluations.WithLabelValues(outcome, pool).Inc()

	verdict := "passed"
	if !ev.Passed {
		verdict = fmt.Sprintf("archived_pool=%v failed_gate=%v", strDeref(poolToString(ev.ArchivedPool)), intDeref(ev.FailedGate))
	}
	c.logger.Info("gate evaluated",
		zap.String("refinement_id", payload.RefinementID.String()),
		zap.String("evaluation_id", ev.ID.String()),
		zap.Bool("passed", ev.Passed),
		zap.String("verdict", verdict),
		zap.Duration("dur", dur),
	)
	_ = msg.Ack()
}

func poolToString(p *domain.ArchivePool) *string {
	if p == nil {
		return nil
	}
	s := string(*p)
	return &s
}

func strDeref(p *string) string {
	if p == nil {
		return ""
	}
	return *p
}

func intDeref(p *int) int {
	if p == nil {
		return -1
	}
	return *p
}
