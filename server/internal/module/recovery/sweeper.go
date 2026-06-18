// Package recovery is the automatic-recovery sweeper for work stranded by
// transient LLM failures.
//
// 问题: DeepSeek 结构化输出偶发抽风 ("No object generated: response did not
// match schema") 会让一条工作永久搁浅, 没有任何东西再重新驱动它:
//   - signal: iii 把 signal-inference 重试 3 次/30s (都落在同一坏窗口) 后丢进
//     DLQ; signals.inference_status 永远停在 'pending', App 上一直转 "AI推演中".
//   - tweet:  classify 连续失败 3 次后 classify_status='failed', 同样无人再捞.
//
// 修法 (本包): 一个周期巡检 worker (仿 exit.Checker), 在我们这一侧的边界上
// 重新驱动 —— 而不是去够 iii 那个我们看不见也控制不住的 DLQ:
//   - signal: 重置该 signal 的 event_outbox 行 (published_at=NULL,
//     publish_attempts=0). Go 的 OutboxWorker 会重新 POST /v1/events/
//     signal-captured 到 iii, 重新入队 analyst. 这正是今天人工恢复用的幂等操作.
//     analyst 失败是概率性的, 重试一次通常就过. RecordInference 由 signal_id
//     派生 client_event_id + ON CONFLICT DO NOTHING, 绝不产生重复信号.
//   - tweet:  把 classify_status 重新置回 'pending' + attempts 清零, poller 的
//     DispatchPending 会再认领分类.
//
// 防呆: 每条记录有一个只增的"复活次数"计数器 (signals.inference_revivals /
// tweets.classify_revivals, 见 migration 027). 超过 MaxRevivals 就停手, 不再对
// 一条真正坏掉的输入无限空转烧 LLM 配额 —— 改成报警 (metrics.RecoveryExhausted),
// 让永久失败显式可见, 交人工处理.
//
// 冷却: 只复活 updated_at/captured_at 已过 Cooldown 的记录. 一来给正常链路 +
// iii 自身重试留出时间, 二来 (signals 用 updated_at) 自然把多次复活在时间上摊开,
// 不会撞在同一个瞬时坏窗口里, 也不会在 analyst 还在跑时就重复入队.
package recovery

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"alphax/server/internal/infra/db"
	"alphax/server/internal/infra/metrics"
)

// Config 巡检参数. 零值由 New 补默认 (与 config.go 的 env 默认对齐).
type Config struct {
	SweepInterval time.Duration // 巡检周期
	Cooldown      time.Duration // 记录"静默"多久才算搁浅, 才去复活
	MaxRevivals   int           // 每条记录最多复活几次, 超过即放弃 (报警)
	BatchSize     int           // 单轮单类最多复活几条
}

// Sweeper 周期扫描搁浅的 signal/tweet 并重新驱动. 多实例安全 (SKIP LOCKED).
type Sweeper struct {
	pool   *db.Pool
	logger *zap.Logger
	cfg    Config
}

func New(pool *db.Pool, logger *zap.Logger, cfg Config) *Sweeper {
	if cfg.SweepInterval <= 0 {
		cfg.SweepInterval = 2 * time.Minute
	}
	if cfg.Cooldown <= 0 {
		cfg.Cooldown = 5 * time.Minute
	}
	if cfg.MaxRevivals <= 0 {
		cfg.MaxRevivals = 5
	}
	if cfg.BatchSize <= 0 {
		cfg.BatchSize = 50
	}
	return &Sweeper{pool: pool, logger: logger, cfg: cfg}
}

// Run blocks until ctx canceled. 启动时立即扫一次 (server 重启后尽快追上积压).
func (s *Sweeper) Run(ctx context.Context) {
	s.logger.Info("recovery sweeper started",
		zap.Duration("interval", s.cfg.SweepInterval),
		zap.Duration("cooldown", s.cfg.Cooldown),
		zap.Int("max_revivals", s.cfg.MaxRevivals),
		zap.Int("batch", s.cfg.BatchSize),
	)
	s.scanOnce(ctx)

	ticker := time.NewTicker(s.cfg.SweepInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			s.logger.Info("recovery sweeper stopped")
			return
		case <-ticker.C:
			s.scanOnce(ctx)
		}
	}
}

func (s *Sweeper) scanOnce(ctx context.Context) {
	start := time.Now()
	defer func() {
		metrics.RecoveryScanDuration.Observe(time.Since(start).Seconds())
	}()

	signals, err := s.reviveStrandedSignals(ctx)
	if err != nil {
		s.logger.Error("recovery: revive signals", zap.Error(err))
	} else if len(signals) > 0 {
		metrics.RecoveryRevivals.WithLabelValues("signal").Add(float64(len(signals)))
		s.logger.Info("recovery: re-armed stranded signals",
			zap.Int("count", len(signals)),
			zap.Strings("signal_ids", sample(signals, 20)),
		)
	}

	tweets, err := s.reviveFailedTweets(ctx)
	if err != nil {
		s.logger.Error("recovery: revive tweets", zap.Error(err))
	} else if len(tweets) > 0 {
		metrics.RecoveryRevivals.WithLabelValues("tweet").Add(float64(len(tweets)))
		s.logger.Info("recovery: re-pended failed tweets",
			zap.Int("count", len(tweets)),
			zap.Strings("tweet_ids", sample(tweets, 20)),
		)
	}

	s.sampleExhausted(ctx)
}

// reviveStrandedSignals 把搁浅信号的 outbox 行重置 (=人工恢复的那条 SQL),
// 并把 inference_revivals +1. 整个动作一条语句原子完成, 返回被复活的 signal_id.
//
// 只命中: pending + 从未完成 + 复活次数未超上限 + updated_at 已过冷却期.
// 用 updated_at 而非 created_at 作冷却基准 —— 复活时同时 bump updated_at, 这样
// 下一轮自然要再等一个 Cooldown, 把多次复活在时间上摊开, 且不会在 analyst 仍在
// 跑 (updated_at 还新) 时重复入队.
func (s *Sweeper) reviveStrandedSignals(ctx context.Context) ([]string, error) {
	const q = `
		WITH revivable AS (
			SELECT s.id, s.source_event_id
			  FROM signals s
			 WHERE s.inference_status = 'pending'
			   AND s.inference_done_at IS NULL
			   AND s.inference_revivals < $1
			   AND s.updated_at < NOW() - make_interval(secs => $2)
			 ORDER BY s.updated_at
			 LIMIT $3
			 FOR UPDATE OF s SKIP LOCKED
		),
		rearmed AS (
			UPDATE event_outbox o
			   SET published_at     = NULL,
			       publish_attempts = 0,
			       last_error       = NULL
			  FROM revivable r
			 WHERE o.event_id = r.source_event_id
			   AND o.subject  = 'signal.captured'
			RETURNING r.id AS signal_id
		)
		UPDATE signals s
		   SET inference_revivals = s.inference_revivals + 1,
		       updated_at         = NOW()
		  FROM rearmed
		 WHERE s.id = rearmed.signal_id
		RETURNING s.id::text
	`
	return s.queryIDs(ctx, q, s.cfg.MaxRevivals, s.cfg.Cooldown.Seconds(), s.cfg.BatchSize)
}

// reviveFailedTweets 把 classify 失败的推文重置回 pending 让 poller 重新认领,
// classify_revivals +1. 返回被复活的 tweet id.
func (s *Sweeper) reviveFailedTweets(ctx context.Context) ([]string, error) {
	const q = `
		UPDATE tweets
		   SET classify_status   = 'pending',
		       classify_attempts = 0,
		       classify_revivals = classify_revivals + 1
		 WHERE id IN (
			SELECT id FROM tweets
			 WHERE classify_status   = 'failed'
			   AND classify_revivals < $1
			   AND captured_at < NOW() - make_interval(secs => $2)
			 ORDER BY captured_at
			 LIMIT $3
			 FOR UPDATE SKIP LOCKED
		 )
		RETURNING id
	`
	return s.queryIDs(ctx, q, s.cfg.MaxRevivals, s.cfg.Cooldown.Seconds(), s.cfg.BatchSize)
}

// sampleExhausted 采样"已放弃"的记录数 (复活次数到顶仍卡住) 写进 gauge.
// 这是让静默永久失败可见的关键指标 —— 对 alphax_recovery_exhausted > 0 告警.
func (s *Sweeper) sampleExhausted(ctx context.Context) {
	const q = `
		SELECT
			(SELECT count(*) FROM signals
			  WHERE inference_status = 'pending'
			    AND inference_done_at IS NULL
			    AND inference_revivals >= $1) AS signals_exhausted,
			(SELECT count(*) FROM tweets
			  WHERE classify_status = 'failed'
			    AND classify_revivals >= $1) AS tweets_exhausted
	`
	var sig, tw int64
	if err := s.pool.QueryRow(ctx, q, s.cfg.MaxRevivals).Scan(&sig, &tw); err != nil {
		s.logger.Warn("recovery: sample exhausted", zap.Error(err))
		return
	}
	metrics.RecoveryExhausted.WithLabelValues("signal").Set(float64(sig))
	metrics.RecoveryExhausted.WithLabelValues("tweet").Set(float64(tw))
	if sig > 0 || tw > 0 {
		// warn 级别: 这些靠自动恢复救不回来了, 需要人工看 (输入坏 / 上游持续故障).
		s.logger.Warn("recovery: records exhausted revival cap (giving up)",
			zap.Int64("signals", sig),
			zap.Int64("tweets", tw),
			zap.Int("cap", s.cfg.MaxRevivals),
		)
	}
}

// queryIDs 跑一条 RETURNING id 的语句, 收集返回的 id 列表.
func (s *Sweeper) queryIDs(ctx context.Context, q string, args ...any) ([]string, error) {
	rows, err := s.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []string
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	if err := rows.Err(); err != nil && err != pgx.ErrNoRows {
		return nil, err
	}
	return ids, nil
}

func sample(xs []string, n int) []string {
	if len(xs) <= n {
		return xs
	}
	return xs[:n]
}
