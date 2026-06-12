package subscription

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"

	"wiseflow/server/internal/infra/twtapi"
)

const (
	pollTick      = 60 * time.Second // 调度心跳 (账号自己的间隔在 poll_interval_sec)
	classifyTick  = 5 * time.Second  // 分类派发节拍
	pollBatch     = 10
	classifyBatch = 4
	quotaPause    = 60 * time.Minute // 402 → 全局暂停, 别空转烧配额
)

// Poller 是订阅模块的后台 worker: 采集 + 分类派发两个节拍.
// 形态同 exit.Checker / iii.OutboxWorker — main.go 里 workerWG.Add(1); go poller.Run(ctx).
type Poller struct {
	svc         *Service
	logger      *zap.Logger
	pausedUntil time.Time
}

func NewPoller(svc *Service, logger *zap.Logger) *Poller {
	return &Poller{svc: svc, logger: logger}
}

// Run blocks until ctx canceled.
func (p *Poller) Run(ctx context.Context) {
	p.logger.Info("subscription poller started",
		zap.Duration("poll_tick", pollTick), zap.Duration("classify_tick", classifyTick))

	// 启动先各跑一次, 重启后立刻追上.
	p.pollOnce(ctx)
	p.svc.DispatchPending(ctx, classifyBatch)

	pollT := time.NewTicker(pollTick)
	defer pollT.Stop()
	classT := time.NewTicker(classifyTick)
	defer classT.Stop()

	for {
		select {
		case <-ctx.Done():
			p.logger.Info("subscription poller stopped")
			return
		case <-pollT.C:
			p.pollOnce(ctx)
		case <-classT.C:
			p.svc.DispatchPending(ctx, classifyBatch)
		}
	}
}

func (p *Poller) pollOnce(ctx context.Context) {
	if time.Now().Before(p.pausedUntil) {
		return
	}
	if err := p.svc.PollDue(ctx, pollBatch); err != nil {
		if errors.Is(err, twtapi.ErrQuotaExceeded) {
			p.pausedUntil = time.Now().Add(quotaPause)
			p.logger.Error("twtapi quota exceeded — pausing all polling",
				zap.Time("until", p.pausedUntil))
			return
		}
		if ctx.Err() == nil {
			p.logger.Warn("poll round failed", zap.Error(err))
		}
	}
}
