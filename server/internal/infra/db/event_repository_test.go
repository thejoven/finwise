package db

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"wiseflow/server/internal/domain"
)

// Integration tests against a real Postgres.
// `make dev` first to start the docker-compose db.
// Skipped if TEST_DATABASE_URL is unset, so `go test ./...` stays useful
// without a live db (per AGENT_BRIEF §2.1 — silent, no required setup).
func testPool(t *testing.T) *Pool {
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
	pool, err := Open(ctx, dsn)
	if err != nil {
		t.Fatalf("open pool: %v", err)
	}
	t.Cleanup(func() { pool.Close() })
	return pool
}

func newCapturedEvent(t *testing.T, userID uuid.UUID) *domain.Event {
	t.Helper()
	payload, err := json.Marshal(map[string]string{"body": "test signal"})
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return &domain.Event{
		UserID:        userID,
		ClientEventID: uuid.New(),
		Type:          domain.EventSignalCaptured,
		Payload:       payload,
		OccurredAt:    time.Now().UTC(),
	}
}

func TestInsertAndList(t *testing.T) {
	pool := testPool(t)
	repo := NewEventRepository(pool)
	ctx := context.Background()
	userID := uuid.New()

	first := newCapturedEvent(t, userID)
	id1, err := repo.Insert(ctx, first)
	if err != nil {
		t.Fatalf("insert first: %v", err)
	}
	if id1 == 0 {
		t.Fatal("expected id assigned")
	}

	second := newCapturedEvent(t, userID)
	second.OccurredAt = first.OccurredAt.Add(time.Second)
	if _, err := repo.Insert(ctx, second); err != nil {
		t.Fatalf("insert second: %v", err)
	}

	got, err := repo.ListByUser(ctx, userID, 10)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	if len(got) != 2 {
		t.Fatalf("want 2 events, got %d", len(got))
	}
	if !got[0].OccurredAt.After(got[1].OccurredAt) {
		t.Fatalf("expected DESC order by occurred_at, got %v then %v",
			got[0].OccurredAt, got[1].OccurredAt)
	}
}

func TestInsertIdempotent(t *testing.T) {
	pool := testPool(t)
	repo := NewEventRepository(pool)
	ctx := context.Background()
	userID := uuid.New()

	e := newCapturedEvent(t, userID)
	id1, err := repo.Insert(ctx, e)
	if err != nil {
		t.Fatalf("first insert: %v", err)
	}

	dup := &domain.Event{
		UserID:        e.UserID,
		ClientEventID: e.ClientEventID,
		Type:          e.Type,
		Payload:       e.Payload,
		OccurredAt:    e.OccurredAt,
	}
	id2, err := repo.Insert(ctx, dup)
	if !errors.Is(err, ErrDuplicateClientEvent) {
		t.Fatalf("want ErrDuplicateClientEvent, got %v", err)
	}
	if id2 != id1 {
		t.Fatalf("duplicate returned id %d, want %d", id2, id1)
	}
}

// TestEventsAreAppendOnly proves REVOKE is honoured at the DB layer.
// If this test fails, the migration didn't run or the role was granted back.
// Either way, the event sourcing guarantee is broken.
func TestEventsAreAppendOnly(t *testing.T) {
	pool := testPool(t)
	repo := NewEventRepository(pool)
	ctx := context.Background()
	userID := uuid.New()

	e := newCapturedEvent(t, userID)
	if _, err := repo.Insert(ctx, e); err != nil {
		t.Fatalf("insert: %v", err)
	}

	tests := []struct {
		name string
		sql  string
	}{
		{"update", "UPDATE events SET type = 'tampered' WHERE id = $1"},
		{"delete", "DELETE FROM events WHERE id = $1"},
		{"truncate", "TRUNCATE events"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var args []any
			if strings.Contains(tc.sql, "$1") {
				args = []any{e.ID}
			}
			_, err := repo.rawExec(ctx, tc.sql, args...)
			if err == nil {
				t.Fatalf("%s succeeded — REVOKE is not in effect", tc.name)
			}
			var pgErr *pgconn.PgError
			if !errors.As(err, &pgErr) || pgErr.Code != "42501" {
				t.Fatalf("%s: want permission denied (42501), got %v", tc.name, err)
			}
		})
	}
}
