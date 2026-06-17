// Command asset-backfill 是「标的追踪」P0 的一次性回填工具.
//
// 把存量 signals.inference_related_assets 全跑一遍 resolver, 落 assets / asset_aliases /
// signal_assets (冻结锚点 = signal.captured_at). 幂等可重跑.
//
// 用法 (需要 DATABASE_URL; 规则啃不动的中文名/裸 ticker 走 Mastra LLM, 故也需 MASTRA_HTTP_URL):
//
//	# 在 205 上 (sources /opt/wiseflow/.env 拿连接串):
//	go run ./cmd/asset-backfill
//	# 仅规则归一 (不配 Mastra, 其余一律 untrackable):
//	go run ./cmd/asset-backfill -mastra-url ''
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"

	"wiseflow/server/internal/infra/db"
	mastrax "wiseflow/server/internal/infra/mastra"
	assetmod "wiseflow/server/internal/module/asset"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "asset-backfill: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		dsn       = flag.String("dsn", os.Getenv("DATABASE_URL"), "Postgres DSN (默认 $DATABASE_URL)")
		mastraURL = flag.String("mastra-url", os.Getenv("MASTRA_HTTP_URL"), "Mastra HTTP URL (默认 $MASTRA_HTTP_URL; 空=只走规则)")
		token     = flag.String("internal-token", os.Getenv("INTERNAL_TOKEN"), "Mastra internal token (默认 $INTERNAL_TOKEN)")
		timeout   = flag.Duration("timeout", 20*time.Minute, "整体超时")
	)
	flag.Parse()

	if *dsn == "" {
		return errors.New("缺少 DATABASE_URL (或 -dsn)")
	}

	ctx, cancel := context.WithTimeout(context.Background(), *timeout)
	defer cancel()

	logger, err := zap.NewProduction()
	if err != nil {
		return fmt.Errorf("logger: %w", err)
	}
	defer func() { _ = logger.Sync() }()

	pool, err := db.Open(ctx, *dsn)
	if err != nil {
		return fmt.Errorf("db open: %w", err)
	}
	defer pool.Close()

	mastraClient := mastrax.New(*mastraURL, *token)
	if mastraClient.IsConfigured() {
		logger.Info("mastra wired — 规则啃不动的走 LLM 归一", zap.String("url", *mastraURL))
	} else {
		logger.Warn("mastra 未配置 — 仅规则归一, 其余一律标 untrackable")
	}

	svc := assetmod.NewService(assetmod.NewRepository(pool), mastraClient, logger)
	stats, err := svc.Backfill(ctx)
	if err != nil {
		return fmt.Errorf("backfill: %w", err)
	}
	fmt.Printf(
		"backfill done: signals=%d refs=%d aliasHits=%d ruleResolved=%d llmResolved=%d untrackable=%d errors=%d\n",
		stats.Signals, stats.Refs, stats.AliasHits, stats.RuleResolved, stats.LLMResolved, stats.Untrackable, stats.Errors,
	)
	return nil
}
