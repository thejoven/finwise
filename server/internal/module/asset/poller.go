package asset

import (
	"context"
	"errors"
	"time"

	"go.uber.org/zap"

	"wiseflow/server/internal/infra/marketdata"
)

const (
	priceTick                 = 30 * time.Minute
	priceBatch                = 20
	priceMinInterval          = 6 * time.Hour          // active 标的至多每 6h 再同步 (日线日更足够)
	priceMaxAttempts          = 5                      // 连续失败上限 → failed 熔断
	priceRatePause            = 30 * time.Minute       // 源限流 → 全局暂停
	priceReqSpacing           = 400 * time.Millisecond // 请求间隔 (非官方源对突发敏感, 别把 IP 打封)
	priceBackfillFallbackDays = 365                    // 无 anchor 标的的回填默认窗口
)

// PricePoller — 行情同步后台 worker (标的追踪 P1). 形态同 subscription.Poller:
// 认领到点标的 → 向 marketdata.Provider 取日线 → upsert asset_prices → 推进状态.
//   - pending 标的从 min(anchor_at) 回填到今日; active 标的从最新 bar 日更.
//   - 源不支持的市场 (P1 的 hk/us) 标 unsupported; 限流全局退避; 多次失败熔断 failed.
type PricePoller struct {
	repo        *Repository
	provider    marketdata.Provider
	logger      *zap.Logger
	pausedUntil time.Time
}

func NewPricePoller(repo *Repository, provider marketdata.Provider, logger *zap.Logger) *PricePoller {
	return &PricePoller{repo: repo, provider: provider, logger: logger}
}

// Run blocks until ctx canceled.
func (p *PricePoller) Run(ctx context.Context) {
	p.logger.Info("asset price poller started",
		zap.String("provider", p.provider.Name()), zap.Duration("tick", priceTick))
	p.tick(ctx) // 启动先跑一次, 重启后立刻追上
	t := time.NewTicker(priceTick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			p.logger.Info("asset price poller stopped")
			return
		case <-t.C:
			p.tick(ctx)
		}
	}
}

func (p *PricePoller) tick(ctx context.Context) {
	if n, bars := p.SyncDue(ctx, priceBatch); n > 0 {
		p.logger.Info("price sync round", zap.Int("assets", n), zap.Int("bars", bars))
	}
}

// SyncDue 认领并同步一批到点标的 (worker tick 与一次性 cmd 复用). 返回 (处理标的数, 写入 bar 数).
func (p *PricePoller) SyncDue(ctx context.Context, batch int) (processed, bars int) {
	if time.Now().Before(p.pausedUntil) {
		return 0, 0
	}
	targets, err := p.repo.ClaimAssetsToPrice(ctx, batch, priceMinInterval)
	if err != nil {
		p.logger.Warn("claim assets to price failed", zap.Error(err))
		return 0, 0
	}
	for i, t := range targets {
		if i > 0 {
			select {
			case <-ctx.Done():
				return processed, bars
			case <-time.After(priceReqSpacing): // 节流, 别突发打封非官方源
			}
		}
		n, err := p.syncTarget(ctx, t)
		processed++
		bars += n
		if err != nil {
			if errors.Is(err, marketdata.ErrRateLimited) {
				p.pausedUntil = time.Now().Add(priceRatePause)
				p.logger.Warn("marketdata rate limited — pausing price poller",
					zap.Time("until", p.pausedUntil))
				return processed, bars
			}
			p.logger.Warn("price sync failed",
				zap.String("market", t.Market), zap.String("canonical", t.Canonical), zap.Error(err))
		}
		if ctx.Err() != nil {
			return processed, bars
		}
	}
	return processed, bars
}

// syncTarget 同步单个标的, 返回写入 bar 数. 失败已在内部记账 (Mark*).
func (p *PricePoller) syncTarget(ctx context.Context, t PriceTarget) (int, error) {
	if !p.provider.Supports(t.Market) {
		return 0, p.repo.MarkPriceUnsupported(ctx, t.ID) // P1: hk/us 暂无 adapter
	}
	from, to := p.window(t)
	bars, err := p.provider.DailyBars(ctx, t.Market, t.Canonical, from, to)
	if err != nil {
		switch {
		case errors.Is(err, marketdata.ErrRateLimited):
			return 0, err // 上抛 → 全局暂停, 不计失败
		case errors.Is(err, marketdata.ErrUnsupported):
			return 0, p.repo.MarkPriceUnsupported(ctx, t.ID)
		default:
			_ = p.repo.MarkPriceFailed(ctx, t.ID, priceMaxAttempts)
			return 0, err
		}
	}
	n, err := p.repo.InsertBars(ctx, t.ID, bars, p.provider.Name())
	if err != nil {
		_ = p.repo.MarkPriceFailed(ctx, t.ID, priceMaxAttempts)
		return 0, err
	}
	if err := p.repo.MarkPriceSynced(ctx, t.ID); err != nil {
		return n, err
	}
	return n, nil
}

// window 定同步区间 [from,to]: to=今日; from = 已有最新 bar (日更, 重取末日以吸收前复权漂移)
// 或锚点 (首次回填从"发现时刻"起) 或兜底窗口 (无关联信号的标的).
func (p *PricePoller) window(t PriceTarget) (from, to time.Time) {
	to = time.Now()
	switch {
	case t.LastDate != nil:
		from = *t.LastDate
	case t.AnchorAt != nil:
		from = *t.AnchorAt
	default:
		from = to.AddDate(0, 0, -priceBackfillFallbackDays)
	}
	return from, to
}
