// Package invite 持有邀请码 (invite_codes) 的数据访问 + 业务逻辑.
//
// 邀请码门禁注册: 管理员在 web-admin 生成码, 受邀人注册时填入. account.Register
// 经注入的闭包调用 Redeem 原子消费一次. 详见 service.go.
package invite

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"wiseflow/server/internal/infra/db"
)

var (
	// ErrNotFound 指定 id 的邀请码不存在.
	ErrNotFound = errors.New("invite code not found")
	// ErrCodeExists 生成的码撞了唯一索引 (极罕见, service 层会重试).
	ErrCodeExists = errors.New("invite code already exists")
	// ErrNotRedeemable 码不存在 / 已吊销 / 已过期 / 已用尽. 兑换失败的统一信号.
	ErrNotRedeemable = errors.New("invite code not redeemable")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// InviteCode 是 invite_codes 表的纯数据视图.
type InviteCode struct {
	ID        uuid.UUID
	Code      string
	Label     *string
	MaxUses   *int
	Uses      int
	ExpiresAt *time.Time
	RevokedAt *time.Time
	CreatedBy *uuid.UUID
	CreatedAt time.Time
}

// CreateInput 是 Repository.Create 的入参. Code 必须已规范化 (service 负责).
type CreateInput struct {
	ID        uuid.UUID
	Code      string
	Label     *string
	MaxUses   *int
	ExpiresAt *time.Time
	CreatedBy *uuid.UUID
}

// Create 写入一条邀请码. code 撞唯一索引返回 ErrCodeExists.
func (r *Repository) Create(ctx context.Context, in CreateInput) (*InviteCode, error) {
	const q = `
		INSERT INTO invite_codes (id, code, label, max_uses, expires_at, created_by)
		VALUES ($1, $2, $3, $4, $5, $6)
		RETURNING id, code, label, max_uses, uses, expires_at, revoked_at, created_by, created_at
	`
	row := r.pool.QueryRow(ctx, q, in.ID, in.Code, in.Label, in.MaxUses, in.ExpiresAt, in.CreatedBy)
	ic, err := scanInvite(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrCodeExists
		}
		return nil, fmt.Errorf("insert invite code: %w", err)
	}
	return ic, nil
}

// List 返回全部邀请码 (新→旧). 单 host 个人 app, 量小不分页.
func (r *Repository) List(ctx context.Context) ([]InviteCode, error) {
	const q = `
		SELECT id, code, label, max_uses, uses, expires_at, revoked_at, created_by, created_at
		FROM invite_codes
		ORDER BY created_at DESC
	`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list invite codes: %w", err)
	}
	defer rows.Close()

	var out []InviteCode
	for rows.Next() {
		ic, err := scanInvite(rows)
		if err != nil {
			return nil, fmt.Errorf("scan invite row: %w", err)
		}
		out = append(out, *ic)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iter invite codes: %w", err)
	}
	return out, nil
}

// Redeem 原子消费一次邀请码. 在单条 UPDATE 里同时校验 (未吊销/未过期/未用尽)
// 和自增 uses —— 并发下只有一个请求能拿到最后一次额度, 其余 0 行受影响.
// code 不可兑换 (含不存在) 返回 ErrNotRedeemable.
func (r *Repository) Redeem(ctx context.Context, code string) error {
	const q = `
		UPDATE invite_codes
		SET uses = uses + 1
		WHERE code = $1
		  AND revoked_at IS NULL
		  AND (expires_at IS NULL OR expires_at > NOW())
		  AND (max_uses IS NULL OR uses < max_uses)
	`
	tag, err := r.pool.Exec(ctx, q, code)
	if err != nil {
		return fmt.Errorf("redeem invite code: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotRedeemable
	}
	return nil
}

// Refund 退回一次额度 (uses-1, 不低于 0). 兑换成功后注册后续步骤失败时的补偿.
// best-effort: 找不到/已是 0 都不报错.
func (r *Repository) Refund(ctx context.Context, code string) error {
	const q = `UPDATE invite_codes SET uses = GREATEST(uses - 1, 0) WHERE code = $1`
	_, err := r.pool.Exec(ctx, q, code)
	return err
}

// Revoke 吊销邀请码 (置 revoked_at=NOW()). 已吊销则保持原 revoked_at (幂等).
// 找不到返回 ErrNotFound.
func (r *Repository) Revoke(ctx context.Context, id uuid.UUID) (*InviteCode, error) {
	const q = `
		UPDATE invite_codes
		SET revoked_at = COALESCE(revoked_at, NOW())
		WHERE id = $1
		RETURNING id, code, label, max_uses, uses, expires_at, revoked_at, created_by, created_at
	`
	row := r.pool.QueryRow(ctx, q, id)
	ic, err := scanInvite(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("revoke invite code: %w", err)
	}
	return ic, nil
}

func scanInvite(row pgx.Row) (*InviteCode, error) {
	var ic InviteCode
	if err := row.Scan(
		&ic.ID, &ic.Code, &ic.Label, &ic.MaxUses, &ic.Uses,
		&ic.ExpiresAt, &ic.RevokedAt, &ic.CreatedBy, &ic.CreatedAt,
	); err != nil {
		return nil, err
	}
	return &ic, nil
}
