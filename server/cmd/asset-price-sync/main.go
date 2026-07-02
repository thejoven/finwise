// Command asset-price-sync 一次性把所有到点标的的行情同步到今日 (标的追踪 P1).
//
// 复用 PricePoller.SyncDue 循环至排空 —— 首次给 pending 标的从锚点回填日线, 已 active 的日更.
// 同 systemd 里常驻的 price poller 同一套逻辑, 这个只是"立即跑一遍"的入口 (验证 / 补数).
//
// 用法 (需 DATABASE_URL; 股票源默认 tencent 国内可达, 加密源默认 okx):
//
//	go run ./cmd/asset-price-sync
//	go run ./cmd/asset-price-sync -provider eastmoney -batch 200
//	CRYPTO_MARKETDATA_PROVIDER=binance go run ./cmd/asset-price-sync
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"time"

	"go.uber.org/zap"

	"alphax/server/internal/infra/db"
	"alphax/server/internal/infra/marketdata"
	assetmod "alphax/server/internal/module/asset"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "asset-price-sync: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		dsn      = flag.String("dsn", os.Getenv("DATABASE_URL"), "Postgres DSN (默认 $DATABASE_URL)")
		provName = flag.String("provider", os.Getenv("MARKETDATA_PROVIDER"), "股票行情源 tencent|eastmoney (默认 tencent)")
		batch    = flag.Int("batch", 200, "每轮认领标的数")
		timeout  = flag.Duration("timeout", 30*time.Minute, "整体超时")
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

	provider := marketdata.NewWithCrypto(*provName, os.Getenv("CRYPTO_MARKETDATA_PROVIDER"))
	poller := assetmod.NewPricePoller(assetmod.NewRepository(pool), provider, logger)
	eq, cr := provider.Name(), provider.Name()
	if nm, ok := provider.(interface{ NameFor(string) string }); ok {
		eq, cr = nm.NameFor(marketdata.MarketA), nm.NameFor(marketdata.MarketCrypto)
	}
	logger.Info("price sync start", zap.String("equity_provider", eq), zap.String("crypto_provider", cr))

	var totalAssets, totalBars int
	// 循环至排空: 每轮认领即置 checked_at=now, 已同步的本轮内不再被认领, 故几轮内收敛.
	for round := 1; round <= 50; round++ {
		n, bars := poller.SyncDue(ctx, *batch)
		totalAssets += n
		totalBars += bars
		if n == 0 {
			break
		}
		logger.Info("round done", zap.Int("round", round), zap.Int("assets", n), zap.Int("bars", bars))
	}
	fmt.Printf("price sync done: assets_synced=%d bars_written=%d\n", totalAssets, totalBars)
	return nil
}
