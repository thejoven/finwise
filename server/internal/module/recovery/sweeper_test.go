// Tests for the recovery sweeper.
//
//   - TestNewDefaults / TestSample: pure unit, run everywhere.
//   - Test*Integration: real Postgres, guarded by TEST_DATABASE_URL/DATABASE_URL
//     (auto-skip when unset, so `go test ./...` stays green with no db).
//     `make dev && make migrate` to run them locally.
package recovery

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/prometheus/client_golang/prometheus/testutil"
	"go.uber.org/zap"

	"wiseflow/server/internal/infra/db"
	"wiseflow/server/internal/infra/metrics"
)

func TestNewDefaults(t *testing.T) {
	s := New(nil, zap.NewNop(), Config{}) // 全零值 → 补默认
	if s.cfg.SweepInterval != 2*time.Minute {
		t.Errorf("SweepInterval = %v, want 2m", s.cfg.SweepInterval)
	}
	if s.cfg.Cooldown != 5*time.Minute {
		t.Errorf("Cooldown = %v, want 5m", s.cfg.Cooldown)
	}
	if s.cfg.MaxRevivals != 5 {
		t.Errorf("MaxRevivals = %d, want 5", s.cfg.MaxRevivals)
	}
	if s.cfg.BatchSize != 50 {
		t.Errorf("BatchSize = %d, want 50", s.cfg.BatchSize)
	}

	// 显式值不被覆盖.
	custom := New(nil, zap.NewNop(), Config{
		SweepInterval: 30 * time.Second,
		Cooldown:      90 * time.Second,
		MaxRevivals:   3,
		BatchSize:     10,
	})
	if custom.cfg.MaxRevivals != 3 || custom.cfg.BatchSize != 10 ||
		custom.cfg.SweepInterval != 30*time.Second || custom.cfg.Cooldown != 90*time.Second {
		t.Errorf("explicit config overridden: %+v", custom.cfg)
	}
}

func TestSample(t *testing.T) {
	xs := []string{"a", "b", "c", "d"}
	if got := sample(xs, 2); len(got) != 2 || got[0] != "a" || got[1] != "b" {
		t.Errorf("sample(xs,2) = %v", got)
	}
	if got := sample(xs, 10); len(got) != 4 {
		t.Errorf("sample(xs,10) len = %d, want 4", len(got))
	}
	if got := sample(nil, 5); got != nil {
		t.Errorf("sample(nil,5) = %v, want nil", got)
	}
}

// ───────────────────── integration ─────────────────────

func testPool(t *testing.T) *db.Pool {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = os.Getenv("DATABASE_URL")
	}
	if dsn == "" {
		t.Skip("TEST_DATABASE_URL (or DATABASE_URL) not set; skipping integration test")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	pool, err := db.Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

// seedUser 造一条 users 行 (signals.user_id 自 021 起有 FK → users).
func seedUser(t *testing.T, pool *db.Pool, userID uuid.UUID) {
	t.Helper()
	email := userID.String() + "@recovery.test"
	if _, err := pool.Exec(context.Background(),
		`INSERT INTO users (id, email, email_lower, password_hash) VALUES ($1, $2, lower($2), '!')`,
		userID, email,
	); err != nil {
		t.Fatalf("seed user: %v", err)
	}
}

// seedStrandedSignal 造一条 pending 信号 + 已发布的 outbox 行, updated_at 可控.
func seedStrandedSignal(t *testing.T, pool *db.Pool, userID uuid.UUID, updatedAt time.Time, revivals int) uuid.UUID {
	t.Helper()
	ctx := context.Background()
	var eventID int64
	if err := pool.QueryRow(ctx,
		`INSERT INTO events (user_id, client_event_id, type, payload, occurred_at)
		 VALUES ($1, $2, 'signal.captured', '{}', $3) RETURNING id`,
		userID, uuid.New(), updatedAt,
	).Scan(&eventID); err != nil {
		t.Fatalf("seed event: %v", err)
	}
	signalID := uuid.New()
	if _, err := pool.Exec(ctx,
		`INSERT INTO signals (id, user_id, raw_text, captured_at, source_event_id,
		                      inference_status, created_at, updated_at, inference_revivals)
		 VALUES ($1, $2, 'test', $3, $4, 'pending', $3, $3, $5)`,
		signalID, userID, updatedAt, eventID, revivals,
	); err != nil {
		t.Fatalf("seed signal: %v", err)
	}
	if _, err := pool.Exec(ctx,
		`INSERT INTO event_outbox (event_id, subject, payload, published_at, publish_attempts)
		 VALUES ($1, 'signal.captured', '{}', $2, 1)`,
		eventID, updatedAt,
	); err != nil {
		t.Fatalf("seed outbox: %v", err)
	}
	return signalID
}

func cleanupUser(t *testing.T, pool *db.Pool, userID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	// 反 FK 序: outbox → signals → events → users.
	_, _ = pool.Exec(ctx, `DELETE FROM event_outbox WHERE event_id IN (SELECT id FROM events WHERE user_id=$1)`, userID)
	_, _ = pool.Exec(ctx, `DELETE FROM signals WHERE user_id=$1`, userID)
	_, _ = pool.Exec(ctx, `DELETE FROM events WHERE user_id=$1`, userID)
	_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id=$1`, userID)
}

func TestReviveStrandedSignalsIntegration(t *testing.T) {
	pool := testPool(t)
	userID := uuid.New()
	t.Cleanup(func() { cleanupUser(t, pool, userID) })
	seedUser(t, pool, userID)

	old := time.Now().UTC().Add(-1 * time.Hour)
	fresh := time.Now().UTC()

	stranded := seedStrandedSignal(t, pool, userID, old, 0)    // 应被复活
	freshSig := seedStrandedSignal(t, pool, userID, fresh, 0)  // 冷却期内, 应跳过
	capped := seedStrandedSignal(t, pool, userID, old, 5)      // 到上限, 应跳过 (且算 exhausted)

	s := New(pool, zap.NewNop(), Config{Cooldown: 5 * time.Minute, MaxRevivals: 5, BatchSize: 50})
	ids, err := s.reviveStrandedSignals(context.Background())
	if err != nil {
		t.Fatalf("reviveStrandedSignals: %v", err)
	}

	got := map[string]bool{}
	for _, id := range ids {
		got[id] = true
	}
	if !got[stranded.String()] {
		t.Errorf("stranded signal %s not revived (revived: %v)", stranded, ids)
	}
	if got[freshSig.String()] {
		t.Errorf("fresh signal %s revived but cooldown should protect it", freshSig)
	}
	if got[capped.String()] {
		t.Errorf("capped signal %s revived but should be at MaxRevivals", capped)
	}

	// 被复活的: outbox 重置 (published_at NULL, attempts 0) + revivals 自增.
	var pubNull bool
	var attempts, revivals int
	if err := pool.QueryRow(context.Background(),
		`SELECT o.published_at IS NULL, o.publish_attempts, s.inference_revivals
		   FROM signals s JOIN event_outbox o ON o.event_id = s.source_event_id
		  WHERE s.id = $1`, stranded,
	).Scan(&pubNull, &attempts, &revivals); err != nil {
		t.Fatalf("read back stranded: %v", err)
	}
	if !pubNull || attempts != 0 {
		t.Errorf("outbox not re-armed: published_at NULL=%v attempts=%d", pubNull, attempts)
	}
	if revivals != 1 {
		t.Errorf("inference_revivals = %d, want 1", revivals)
	}

	// exhausted gauge 应统计到那条 capped 信号 (>=1).
	s.sampleExhausted(context.Background())
	if g := testutil.ToFloat64(metrics.RecoveryExhausted.WithLabelValues("signal")); g < 1 {
		t.Errorf("RecoveryExhausted{signal} = %v, want >= 1", g)
	}
}

// seedFailedTweet 造一条 classify 失败的推文 (+ 它依赖的 twitter_accounts).
func seedFailedTweet(t *testing.T, pool *db.Pool, capturedAt time.Time, revivals int) (tweetID string, accountID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	accountID = uuid.New()
	restID := "test-" + accountID.String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO twitter_accounts (id, rest_id, handle) VALUES ($1, $2, 'tester')`,
		accountID, restID,
	); err != nil {
		t.Fatalf("seed twitter_account: %v", err)
	}
	tweetID = "tw-" + uuid.New().String()
	if _, err := pool.Exec(ctx,
		`INSERT INTO tweets (id, twitter_account_id, text, raw_payload, classify_status,
		                     classify_attempts, classify_revivals, captured_at)
		 VALUES ($1, $2, 'hello', '{}', 'failed', 3, $3, $4)`,
		tweetID, accountID, revivals, capturedAt,
	); err != nil {
		t.Fatalf("seed tweet: %v", err)
	}
	return tweetID, accountID
}

func TestReviveFailedTweetsIntegration(t *testing.T) {
	pool := testPool(t)
	old := time.Now().UTC().Add(-1 * time.Hour)

	tweetID, accID := seedFailedTweet(t, pool, old, 0)        // 应被复活
	cappedID, cappedAcc := seedFailedTweet(t, pool, old, 5)   // 到上限, 应跳过
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM tweets WHERE twitter_account_id = ANY($1)`, []uuid.UUID{accID, cappedAcc})
		_, _ = pool.Exec(ctx, `DELETE FROM twitter_accounts WHERE id = ANY($1)`, []uuid.UUID{accID, cappedAcc})
	})

	s := New(pool, zap.NewNop(), Config{Cooldown: 5 * time.Minute, MaxRevivals: 5, BatchSize: 50})
	ids, err := s.reviveFailedTweets(context.Background())
	if err != nil {
		t.Fatalf("reviveFailedTweets: %v", err)
	}
	got := map[string]bool{}
	for _, id := range ids {
		got[id] = true
	}
	if !got[tweetID] {
		t.Errorf("failed tweet %s not re-pended (revived: %v)", tweetID, ids)
	}
	if got[cappedID] {
		t.Errorf("capped tweet %s re-pended but should be at MaxRevivals", cappedID)
	}

	var status string
	var attempts, revivals int
	if err := pool.QueryRow(context.Background(),
		`SELECT classify_status, classify_attempts, classify_revivals FROM tweets WHERE id=$1`, tweetID,
	).Scan(&status, &attempts, &revivals); err != nil {
		t.Fatalf("read back tweet: %v", err)
	}
	if status != "pending" || attempts != 0 || revivals != 1 {
		t.Errorf("tweet not re-pended cleanly: status=%s attempts=%d revivals=%d", status, attempts, revivals)
	}
}
