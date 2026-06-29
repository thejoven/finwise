package report

import (
	"context"
	"time"

	"go.uber.org/zap"
)

// GenConfig — 调度参数.
type GenConfig struct {
	ScanInterval time.Duration // 轮询周期 (判断是否到点/是否已生成)
	HourLocal    int           // 当地几点后生成 (0-23)
}

// Generator — 每日一次的早报生成 worker. 既有 worker 都是 interval ticker, 无墙钟调度,
// 故自建幂等"每日一次": 每个 tick 看是否已过当地 HourLocal 且今天还没生成 → 生成.
// 单进程 (systemd) + GlobalExists 判定 + UNIQUE(edition_date,language) 三重保证不重复生成;
// 启动即 tick 一次 → server 在 08:00 后重启也能立刻补刊.
type Generator struct {
	svc    *Service
	loc    *time.Location
	cfg    GenConfig
	logger *zap.Logger
}

func NewGenerator(svc *Service, loc *time.Location, cfg GenConfig, logger *zap.Logger) *Generator {
	if cfg.ScanInterval <= 0 {
		cfg.ScanInterval = time.Minute
	}
	if loc == nil {
		loc = time.UTC
	}
	return &Generator{svc: svc, loc: loc, cfg: cfg, logger: logger}
}

// Run blocks until ctx canceled. 启动立即扫一次 (重启补刊).
func (g *Generator) Run(ctx context.Context) {
	g.logger.Info("morning report generator started",
		zap.Int("hour_local", g.cfg.HourLocal),
		zap.String("tz", g.loc.String()),
		zap.Duration("scan", g.cfg.ScanInterval),
	)
	g.tick(ctx)

	ticker := time.NewTicker(g.cfg.ScanInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			g.logger.Info("morning report generator stopped")
			return
		case <-ticker.C:
			g.tick(ctx)
		}
	}
}

func (g *Generator) tick(ctx context.Context) {
	now := time.Now().In(g.loc)
	if now.Hour() < g.cfg.HourLocal {
		return // 未到点
	}
	editionDate := now.Format("2006-01-02")

	exists, err := g.svc.GlobalDigestExists(ctx, editionDate)
	if err != nil {
		g.logger.Error("morning report: exists check", zap.Error(err))
		return
	}
	if exists {
		return // 今天已生成 (幂等)
	}

	g.logger.Info("morning report: generating", zap.String("edition", editionDate))
	if err := g.svc.GenerateForEditionDate(ctx, editionDate); err != nil {
		g.logger.Error("morning report: generate failed",
			zap.String("edition", editionDate), zap.Error(err))
		return
	}
	g.logger.Info("morning report: generated", zap.String("edition", editionDate))
}
