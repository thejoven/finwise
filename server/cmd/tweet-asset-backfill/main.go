// Command tweet-asset-backfill 给存量推文回填相关标的 (开发文档 15 · P2).
//
// 对已分类完成 (classify_status=done)、相关度够、还没链任何标的的推文, 重过一遍 mastra
// tweet-classify 只取其 related_assets, 复用 asset resolver 归一后写 tweet_assets.
// **只补标的, 不动 tags/summary** (与把推文 reset 成 pending 重分类不同). 幂等可重跑.
//
// 用法 (需要 DATABASE_URL + MASTRA_HTTP_URL; 在 205 上先 source /opt/alphax/.env):
//
//	go run ./cmd/tweet-asset-backfill                          # 默认回填近 500 条 relevance≥0.4 的
//	go run ./cmd/tweet-asset-backfill -limit 100 -min-relevance 0.5
package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"go.uber.org/zap"

	"alphax/server/internal/infra/db"
	mastrax "alphax/server/internal/infra/mastra"
	assetmod "alphax/server/internal/module/asset"
	subscriptionmod "alphax/server/internal/module/subscription"
)

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "tweet-asset-backfill: "+err.Error())
		os.Exit(1)
	}
}

func run() error {
	var (
		dsn          = flag.String("dsn", os.Getenv("DATABASE_URL"), "Postgres DSN (默认 $DATABASE_URL)")
		mastraURL    = flag.String("mastra-url", os.Getenv("MASTRA_HTTP_URL"), "Mastra HTTP URL (默认 $MASTRA_HTTP_URL)")
		token        = flag.String("internal-token", os.Getenv("INTERNAL_TOKEN"), "Mastra internal token (默认 $INTERNAL_TOKEN)")
		limit        = flag.Int("limit", 500, "最多回填多少条推文")
		minRelevance = flag.Float64("min-relevance", 0.4, "只回填 relevance ≥ 此值的推文 (低相关多无标的)")
		language     = flag.String("language", "zh-Hans", "标的 rationale 输出语言")
		concurrency  = flag.Int("concurrency", 5, "并发数 (别太高, 免得压垮 mastra/LLM)")
		timeout      = flag.Duration("timeout", 30*time.Minute, "整体超时")
	)
	flag.Parse()

	if *dsn == "" {
		return errors.New("缺少 DATABASE_URL (或 -dsn)")
	}
	if *concurrency < 1 {
		*concurrency = 1
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
	if !mastraClient.IsConfigured() {
		return errors.New("mastra 未配置 (需要 MASTRA_HTTP_URL): 标的抽取依赖它")
	}

	assetSvc := assetmod.NewService(assetmod.NewRepository(pool), mastraClient, logger)
	repo := subscriptionmod.NewRepository(pool)

	tweets, err := repo.ListTweetsForAssetBackfill(ctx, *limit, *minRelevance)
	if err != nil {
		return fmt.Errorf("list candidates: %w", err)
	}
	logger.Info("tweet-asset-backfill start",
		zap.Int("candidates", len(tweets)),
		zap.Float64("min_relevance", *minRelevance),
		zap.Int("concurrency", *concurrency))

	var processed, withAssets, links, resolveErr int64
	sem := make(chan struct{}, *concurrency)
	var wg sync.WaitGroup

	for _, t := range tweets {
		if ctx.Err() != nil {
			break
		}
		wg.Add(1)
		sem <- struct{}{}
		go func(p subscriptionmod.PendingTweet) {
			defer wg.Done()
			defer func() { <-sem }()

			res, err := mastraClient.ClassifyTweet(ctx, mastrax.TweetClassifyRequest{
				TweetText:    p.Text,
				AuthorHandle: p.Handle,
				Lang:         p.Lang,
				Language:     *language,
			})
			if n := atomic.AddInt64(&processed, 1); n%25 == 0 {
				logger.Info("progress",
					zap.Int64("processed", n), zap.Int("total", len(tweets)),
					zap.Int64("links", atomic.LoadInt64(&links)))
			}
			if err != nil {
				logger.Warn("classify failed", zap.String("tweet_id", p.ID), zap.Error(err))
				return
			}
			linked := false
			for _, a := range res.RelatedAssets {
				ticker := strings.TrimSpace(a.Ticker)
				if ticker == "" {
					continue
				}
				cx := a.Rationale
				if cx == "" {
					cx = p.Text
				}
				assetID, err := assetSvc.ResolveReference(ctx, ticker, cx)
				if err != nil {
					atomic.AddInt64(&resolveErr, 1)
					logger.Warn("resolve failed", zap.String("ticker", ticker), zap.Error(err))
					continue
				}
				if err := repo.LinkTweetAsset(ctx, p.ID, assetID, a.Rationale); err != nil {
					logger.Warn("link failed", zap.String("tweet_id", p.ID), zap.Error(err))
					continue
				}
				atomic.AddInt64(&links, 1)
				linked = true
			}
			if linked {
				atomic.AddInt64(&withAssets, 1)
			}
		}(t)
	}
	wg.Wait()

	fmt.Printf("tweet-asset-backfill done: candidates=%d processed=%d withAssets=%d links=%d resolveErrors=%d\n",
		len(tweets), atomic.LoadInt64(&processed), atomic.LoadInt64(&withAssets),
		atomic.LoadInt64(&links), atomic.LoadInt64(&resolveErr))
	return nil
}
