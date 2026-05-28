// Package account 持有用户身份 (users) 和会话 (sessions) 的数据访问.
//
// 设计选择:
//   - sessions 是 opaque random token 表, 不是 JWT. 优点: 即刻吊销, 不需要密钥
//     管理; 缺点: 每个请求多一次 DB lookup — 单 host 下可以接受.
//   - email 唯一性走 email_lower (lowercase) 索引, 避免 Postgres citext 扩展
//     的安装要求.
//   - DEV_USER_ID 兼容: 旧的 dev bearer 走另一条中间件分支, 不进 sessions 表.
package account

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"flashfi/server/internal/infra/db"
)

var (
	ErrNotFound        = errors.New("user not found")
	ErrEmailExists     = errors.New("email already registered")
	ErrSessionNotFound = errors.New("session not found")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// User 是 users 表的纯数据视图. password_hash 不出包外.
type User struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	DisplayName  *string
	AvatarURL    *string
	Bio          *string
	CreatedAt    time.Time
	UpdatedAt    time.Time
}

// CreateUserInput 是 Repository.CreateUser 的入参.
// PasswordHash 必须已经是 bcrypt 输出 — service 层负责 hash.
type CreateUserInput struct {
	ID           uuid.UUID
	Email        string
	PasswordHash string
	DisplayName  *string
}

// CreateUser 写入 users 行. 冲突邮箱返回 ErrEmailExists.
func (r *Repository) CreateUser(ctx context.Context, in CreateUserInput) (*User, error) {
	emailLower := strings.ToLower(strings.TrimSpace(in.Email))
	const q = `
		INSERT INTO users (id, email, email_lower, password_hash, display_name)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, email, password_hash, display_name, avatar_url, bio, created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, q, in.ID, in.Email, emailLower, in.PasswordHash, in.DisplayName)
	u, err := scanUser(row)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrEmailExists
		}
		return nil, fmt.Errorf("insert user: %w", err)
	}
	return u, nil
}

// FindByEmail 用小写邮箱查找用户. 找不到返回 ErrNotFound.
func (r *Repository) FindByEmail(ctx context.Context, email string) (*User, error) {
	const q = `
		SELECT id, email, password_hash, display_name, avatar_url, bio, created_at, updated_at
		FROM users
		WHERE email_lower = $1
	`
	row := r.pool.QueryRow(ctx, q, strings.ToLower(strings.TrimSpace(email)))
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return u, nil
}

// FindByID 按 uuid 查用户.
func (r *Repository) FindByID(ctx context.Context, id uuid.UUID) (*User, error) {
	const q = `
		SELECT id, email, password_hash, display_name, avatar_url, bio, created_at, updated_at
		FROM users
		WHERE id = $1
	`
	row := r.pool.QueryRow(ctx, q, id)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, err
	}
	return u, nil
}

// UpdateProfileInput 是可选字段集. nil 表示该字段不动.
type UpdateProfileInput struct {
	DisplayName *string
	Bio         *string
	AvatarURL   *string
}

// UpdateProfile 部分更新 users 行的可编辑字段. 全空时不改 updated_at.
func (r *Repository) UpdateProfile(ctx context.Context, id uuid.UUID, in UpdateProfileInput) (*User, error) {
	const q = `
		UPDATE users SET
			display_name = COALESCE($2, display_name),
			bio          = COALESCE($3, bio),
			avatar_url   = COALESCE($4, avatar_url),
			updated_at   = NOW()
		WHERE id = $1
		RETURNING id, email, password_hash, display_name, avatar_url, bio, created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, q, id, in.DisplayName, in.Bio, in.AvatarURL)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update profile: %w", err)
	}
	return u, nil
}

// EnsurePlaceholder 是给 dev bearer 兼容用的: 没行就插一行 placeholder,
// 有行就 noop. 不返回 user — 调用方只关心存在性.
func (r *Repository) EnsurePlaceholder(ctx context.Context, id uuid.UUID, email string) error {
	const q = `
		INSERT INTO users (id, email, email_lower, password_hash, display_name)
		VALUES ($1, $2, $3, '!', 'dev')
		ON CONFLICT DO NOTHING
	`
	_, err := r.pool.Exec(ctx, q, id, email, strings.ToLower(email))
	return err
}

// UpdatePasswordHash 改密码 hash. 调用方应该已经验过旧密码.
func (r *Repository) UpdatePasswordHash(ctx context.Context, id uuid.UUID, newHash string) error {
	const q = `UPDATE users SET password_hash = $2, updated_at = NOW() WHERE id = $1`
	tag, err := r.pool.Exec(ctx, q, id, newHash)
	if err != nil {
		return fmt.Errorf("update password: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return ErrNotFound
	}
	return nil
}

// ────── sessions ──────

// Session 是查到的 sessions 行.
type Session struct {
	Token      string
	UserID     uuid.UUID
	ExpiresAt  time.Time
	CreatedAt  time.Time
	LastSeenAt time.Time
}

// CreateSession 落库一条会话. token 由 service 生成 (32-byte random).
func (r *Repository) CreateSession(ctx context.Context, token string, userID uuid.UUID, expiresAt time.Time) (*Session, error) {
	const q = `
		INSERT INTO sessions (token, user_id, expires_at)
		VALUES ($1, $2, $3)
		RETURNING token, user_id, expires_at, created_at, last_seen_at
	`
	row := r.pool.QueryRow(ctx, q, token, userID, expiresAt)
	var s Session
	if err := row.Scan(&s.Token, &s.UserID, &s.ExpiresAt, &s.CreatedAt, &s.LastSeenAt); err != nil {
		return nil, fmt.Errorf("insert session: %w", err)
	}
	return &s, nil
}

// LookupSession 按 token 查 user_id, 并验证未过期. 同时 bump last_seen_at.
// 返回 ErrSessionNotFound 表示 token 不存在或已过期.
func (r *Repository) LookupSession(ctx context.Context, token string) (*Session, error) {
	const q = `
		UPDATE sessions
		SET last_seen_at = NOW()
		WHERE token = $1 AND expires_at > NOW()
		RETURNING token, user_id, expires_at, created_at, last_seen_at
	`
	row := r.pool.QueryRow(ctx, q, token)
	var s Session
	if err := row.Scan(&s.Token, &s.UserID, &s.ExpiresAt, &s.CreatedAt, &s.LastSeenAt); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrSessionNotFound
		}
		return nil, fmt.Errorf("lookup session: %w", err)
	}
	return &s, nil
}

// DeleteSession 删除指定 token. 不存在不报错.
func (r *Repository) DeleteSession(ctx context.Context, token string) error {
	const q = `DELETE FROM sessions WHERE token = $1`
	_, err := r.pool.Exec(ctx, q, token)
	return err
}

// DeleteUserSessions 删除某 user 的全部 session. 改密码后用.
func (r *Repository) DeleteUserSessions(ctx context.Context, userID uuid.UUID) error {
	const q = `DELETE FROM sessions WHERE user_id = $1`
	_, err := r.pool.Exec(ctx, q, userID)
	return err
}

func scanUser(row pgx.Row) (*User, error) {
	var u User
	if err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.Bio, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}
