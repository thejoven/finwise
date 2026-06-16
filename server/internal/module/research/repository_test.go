// Integration tests for the research repository, guarded by
// TEST_DATABASE_URL/DATABASE_URL (auto-skip with no db, so `go test ./...`
// stays green). `make dev && make migrate` to run locally — they need
// migration 028 (uq_signal_research_signal) applied for the ON CONFLICT path.
package research

import (
	"context"
	"os"
	"testing"
	"time"

	"github.com/google/uuid"

	"wiseflow/server/internal/infra/db"
)

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

func countSignalScope(t *testing.T, pool *db.Pool, signalID uuid.UUID) int {
	t.Helper()
	var n int
	if err := pool.QueryRow(context.Background(),
		`SELECT count(*) FROM signal_research WHERE scope='signal' AND signal_id=$1`, signalID,
	).Scan(&n); err != nil {
		t.Fatalf("count signal scope: %v", err)
	}
	return n
}

// 同一 signal_id 重复 Save signal-scope → 只一行, 内容刷成最新, id/created_at 稳定.
func TestSaveSignalScopeIdempotent(t *testing.T) {
	pool := testPool(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	userID := uuid.New()
	signalID := uuid.New()
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM signal_research WHERE user_id=$1`, userID) })

	first, err := repo.Save(ctx, SaveInput{
		UserID: userID, Scope: ScopeSignal, SignalID: &signalID,
		Query: "q1", Model: "m1",
		Results: []Result{{Title: "t1", URL: "https://a"}},
	})
	if err != nil {
		t.Fatalf("first save: %v", err)
	}

	// 模拟重跑推演: 同 signal, 不同检索内容.
	second, err := repo.Save(ctx, SaveInput{
		UserID: userID, Scope: ScopeSignal, SignalID: &signalID,
		Query: "q2", Model: "m2",
		Results: []Result{{Title: "t2", URL: "https://b"}, {Title: "t3", URL: "https://c"}},
	})
	if err != nil {
		t.Fatalf("second save: %v", err)
	}

	if n := countSignalScope(t, pool, signalID); n != 1 {
		t.Fatalf("expected exactly 1 signal-scope row, got %d", n)
	}
	// id + created_at 稳定 (DO UPDATE 命中同一行).
	if first.ID != second.ID {
		t.Errorf("id changed across saves: %s → %s", first.ID, second.ID)
	}
	if !first.CreatedAt.Equal(second.CreatedAt) {
		t.Errorf("created_at changed: %v → %v", first.CreatedAt, second.CreatedAt)
	}
	// 持久化内容 = 最新一次.
	var gotQuery, gotModel string
	var gotResults []byte
	if err := pool.QueryRow(ctx,
		`SELECT query, model, results FROM signal_research WHERE id=$1`, second.ID,
	).Scan(&gotQuery, &gotModel, &gotResults); err != nil {
		t.Fatalf("read back: %v", err)
	}
	if gotQuery != "q2" || gotModel != "m2" {
		t.Errorf("content not refreshed to latest: query=%q model=%q", gotQuery, gotModel)
	}
}

// refinement_round 行不被 signal-scope 唯一索引波及: 多轮共存, 且可与同 signal_id 的
// signal-scope 行并存.
func TestSaveRefinementRoundsNotDeduped(t *testing.T) {
	pool := testPool(t)
	repo := NewRepository(pool)
	ctx := context.Background()

	userID := uuid.New()
	signalID := uuid.New()
	refinementID := uuid.New()
	t.Cleanup(func() { _, _ = pool.Exec(ctx, `DELETE FROM signal_research WHERE user_id=$1`, userID) })

	// 同 signal 的 signal-scope 行.
	if _, err := repo.Save(ctx, SaveInput{
		UserID: userID, Scope: ScopeSignal, SignalID: &signalID, Query: "sig", Model: "m",
		Results: []Result{{Title: "s"}},
	}); err != nil {
		t.Fatalf("save signal scope: %v", err)
	}

	// 两轮 refinement_round (带同一 primary signal_id).
	for _, round := range []int{1, 2} {
		rd := round
		if _, err := repo.Save(ctx, SaveInput{
			UserID: userID, Scope: ScopeRefinementRound,
			SignalID: &signalID, RefinementID: &refinementID, Round: &rd,
			Query: "round", Model: "m", Results: []Result{{Title: "r"}},
		}); err != nil {
			t.Fatalf("save round %d: %v", round, err)
		}
	}

	// signal-scope 仍只 1 条.
	if n := countSignalScope(t, pool, signalID); n != 1 {
		t.Errorf("signal-scope rows = %d, want 1", n)
	}
	// refinement_round 两条都在.
	var rounds int
	if err := pool.QueryRow(ctx,
		`SELECT count(*) FROM signal_research WHERE scope='refinement_round' AND refinement_id=$1`, refinementID,
	).Scan(&rounds); err != nil {
		t.Fatalf("count rounds: %v", err)
	}
	if rounds != 2 {
		t.Errorf("refinement_round rows = %d, want 2", rounds)
	}

	// 读路径仍正常: ListBySession 返回 signal-scope(1) + rounds(2) = 3.
	recs, err := repo.ListBySession(ctx, userID, refinementID, signalID)
	if err != nil {
		t.Fatalf("ListBySession: %v", err)
	}
	if len(recs) != 3 {
		t.Errorf("ListBySession returned %d records, want 3", len(recs))
	}
}
