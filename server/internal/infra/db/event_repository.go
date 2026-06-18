package db

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5/pgconn"

	"alphax/server/internal/domain"
)

// ErrDuplicateClientEvent indicates the (user_id, client_event_id) pair already exists.
// This is the contract that makes client retries safe — the API can return 200 on dup.
var ErrDuplicateClientEvent = errors.New("duplicate client_event_id")

type EventRepository struct {
	pool *Pool
}

func NewEventRepository(pool *Pool) *EventRepository {
	return &EventRepository{pool: pool}
}

// Insert appends a new event. Returns the assigned id.
// Idempotent on (user_id, client_event_id): the second call returns
// ErrDuplicateClientEvent and the existing row's id.
func (r *EventRepository) Insert(ctx context.Context, e *domain.Event) (int64, error) {
	const q = `
		INSERT INTO events (
			user_id, client_event_id, type, payload,
			occurred_at,
			causation_id, correlation_id,
			related_asset, related_thesis
		) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING id, recorded_at
	`

	row := r.pool.QueryRow(ctx, q,
		e.UserID, e.ClientEventID, string(e.Type), e.Payload,
		e.OccurredAt,
		e.CausationID, e.CorrelationID,
		e.RelatedAsset, e.RelatedThesis,
	)

	if err := row.Scan(&e.ID, &e.RecordedAt); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			existingID, lookupErr := r.lookupByClientEventID(ctx, e.UserID, e.ClientEventID)
			if lookupErr != nil {
				return 0, fmt.Errorf("dup detected, lookup failed: %w", lookupErr)
			}
			e.ID = existingID
			return existingID, ErrDuplicateClientEvent
		}
		return 0, fmt.Errorf("insert event: %w", err)
	}
	return e.ID, nil
}

func (r *EventRepository) lookupByClientEventID(ctx context.Context, userID, clientEventID uuid.UUID) (int64, error) {
	const q = `SELECT id FROM events WHERE user_id = $1 AND client_event_id = $2`
	var id int64
	if err := r.pool.QueryRow(ctx, q, userID, clientEventID).Scan(&id); err != nil {
		return 0, err
	}
	return id, nil
}

// ListByUser returns the user's events ordered by occurred_at DESC.
// `limit` capped at 200 to keep responses bounded.
func (r *EventRepository) ListByUser(ctx context.Context, userID uuid.UUID, limit int) ([]domain.Event, error) {
	if limit <= 0 || limit > 200 {
		limit = 200
	}

	const q = `
		SELECT id, user_id, client_event_id, type, payload,
		       occurred_at, recorded_at,
		       causation_id, correlation_id,
		       related_asset, related_thesis
		FROM events
		WHERE user_id = $1
		ORDER BY occurred_at DESC
		LIMIT $2
	`

	rows, err := r.pool.Query(ctx, q, userID, limit)
	if err != nil {
		return nil, fmt.Errorf("query events: %w", err)
	}
	defer rows.Close()

	out := make([]domain.Event, 0, limit)
	for rows.Next() {
		var e domain.Event
		var typ string
		if err := rows.Scan(
			&e.ID, &e.UserID, &e.ClientEventID, &typ, &e.Payload,
			&e.OccurredAt, &e.RecordedAt,
			&e.CausationID, &e.CorrelationID,
			&e.RelatedAsset, &e.RelatedThesis,
		); err != nil {
			return nil, fmt.Errorf("scan event: %w", err)
		}
		e.Type = domain.EventType(typ)
		out = append(out, e)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iter: %w", err)
	}
	return out, nil
}

// rawExec is exposed for tests that need to issue UPDATE/DELETE
// in order to prove REVOKE works at the DB layer. Not used by production code.
func (r *EventRepository) rawExec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error) {
	return r.pool.Exec(ctx, sql, args...)
}
