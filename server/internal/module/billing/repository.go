// Package billing 持有 App 内购 (App Store 订阅, 经 RevenueCat) 的服务端真相:
// 每用户的 entitlement 状态投影 + webhook 原始事件流水.
//
// 注意: 与 module/subscription (X 推文订阅) 无关 —— 那是采集数据源, 这是付费订阅.
package billing

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"alphax/server/internal/infra/db"
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Entitlement 是 user_entitlements 一行的投影.
type Entitlement struct {
	UserID        uuid.UUID
	EntitlementID string
	IsActive      bool
	ProductID     *string
	Store         *string
	ExpiresAt     *time.Time
	WillRenew     bool
	UpdatedAt     time.Time
}

// GetEntitlement 取某用户某 entitlement 的当前状态. 没有行返回 (nil, nil) —— 视为
// 未订阅, 不是错误 (大多数用户没订阅, 不该当异常).
func (r *Repository) GetEntitlement(ctx context.Context, userID uuid.UUID, entitlementID string) (*Entitlement, error) {
	const q = `
		SELECT user_id, entitlement_id, is_active, product_id, store, expires_at, will_renew, updated_at
		FROM user_entitlements
		WHERE user_id = $1 AND entitlement_id = $2
	`
	row := r.pool.QueryRow(ctx, q, userID, entitlementID)
	var e Entitlement
	if err := row.Scan(
		&e.UserID, &e.EntitlementID, &e.IsActive, &e.ProductID, &e.Store, &e.ExpiresAt, &e.WillRenew, &e.UpdatedAt,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, nil
		}
		return nil, fmt.Errorf("get entitlement: %w", err)
	}
	return &e, nil
}

// UpsertEntitlement 写入/更新某 (用户, entitlement) 的状态. 幂等: 主键冲突即覆盖.
// eventID 记成 last_event_id, 方便追溯是哪条事件把状态改成现在这样.
func (r *Repository) UpsertEntitlement(ctx context.Context, e Entitlement, eventID string) error {
	const q = `
		INSERT INTO user_entitlements
			(user_id, entitlement_id, is_active, product_id, store, expires_at, will_renew, last_event_id, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
		ON CONFLICT (user_id, entitlement_id) DO UPDATE SET
			is_active     = EXCLUDED.is_active,
			product_id    = EXCLUDED.product_id,
			store         = EXCLUDED.store,
			expires_at    = EXCLUDED.expires_at,
			will_renew    = EXCLUDED.will_renew,
			last_event_id = EXCLUDED.last_event_id,
			updated_at    = NOW()
	`
	_, err := r.pool.Exec(ctx, q,
		e.UserID, e.EntitlementID, e.IsActive, e.ProductID, e.Store, e.ExpiresAt, e.WillRenew, eventID,
	)
	if err != nil {
		return fmt.Errorf("upsert entitlement: %w", err)
	}
	return nil
}

// EventRecord 是一条 RevenueCat webhook 原始事件 (落 iap_events).
type EventRecord struct {
	EventID     string
	UserID      *uuid.UUID // event.app_user_id 解析成 uuid; 非法时 nil
	Type        string
	Environment string
	Payload     []byte // 原始 JSON
}

// RecordEvent 落库一条 webhook 事件. 幂等: event_id 冲突 (重复投递) 返回 isNew=false,
// 调用方据此跳过重复投影.
func (r *Repository) RecordEvent(ctx context.Context, ev EventRecord) (isNew bool, err error) {
	const q = `
		INSERT INTO iap_events (event_id, user_id, type, environment, payload)
		VALUES ($1, $2, $3, $4, $5::jsonb)
		ON CONFLICT (event_id) DO NOTHING
	`
	tag, err := r.pool.Exec(ctx, q, ev.EventID, ev.UserID, ev.Type, ev.Environment, string(ev.Payload))
	if err != nil {
		return false, fmt.Errorf("record iap event: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}
