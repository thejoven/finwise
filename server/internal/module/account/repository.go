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

	"alphax/server/internal/infra/db"
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
	AvatarURL    *string // 旧列, 新流程不再写入 (头像改走 avatar_object_key + 现签 URL)
	// AvatarObjectKey 是头像对象存储键 (avatars/<id>). nil = 无头像; 非 nil → DTO 现签 avatar_url.
	AvatarObjectKey *string
	Bio             *string
	Language        *string // 'zh-Hans' | 'zh-Hant' | 'en'; nil = 未设置 (按默认简体处理)
	IsAdmin         bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
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
		RETURNING id, email, password_hash, display_name, avatar_url, avatar_object_key, bio, language, is_admin, created_at, updated_at
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
		SELECT id, email, password_hash, display_name, avatar_url, avatar_object_key, bio, language, is_admin, created_at, updated_at
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
		SELECT id, email, password_hash, display_name, avatar_url, avatar_object_key, bio, language, is_admin, created_at, updated_at
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
// 头像不在此 (改走 avatar_object_key + 预签名直传 + 现签 URL, 见 SetAvatarKey).
type UpdateProfileInput struct {
	DisplayName *string
	Bio         *string
	Language    *string // nil = 不动; 否则覆盖 (mobile 切语言时静默 PATCH)
}

// UpdateProfile 部分更新 users 行的可编辑字段. 全空时不改 updated_at.
func (r *Repository) UpdateProfile(ctx context.Context, id uuid.UUID, in UpdateProfileInput) (*User, error) {
	const q = `
		UPDATE users SET
			display_name = COALESCE($2, display_name),
			bio          = COALESCE($3, bio),
			language     = COALESCE($4, language),
			updated_at   = NOW()
		WHERE id = $1
		RETURNING id, email, password_hash, display_name, avatar_url, avatar_object_key, bio, language, is_admin, created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, q, id, in.DisplayName, in.Bio, in.Language)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("update profile: %w", err)
	}
	return u, nil
}

// SetAvatarKey 设置 (或清除, key=nil) 头像对象键, 并 bump updated_at (兼作头像 URL 版本号).
func (r *Repository) SetAvatarKey(ctx context.Context, id uuid.UUID, key *string) (*User, error) {
	const q = `
		UPDATE users SET avatar_object_key = $2, updated_at = NOW()
		WHERE id = $1
		RETURNING id, email, password_hash, display_name, avatar_url, avatar_object_key, bio, language, is_admin, created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, q, id, key)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("set avatar key: %w", err)
	}
	return u, nil
}

// EnsurePlaceholder 是给 dev bearer 兼容用的: 没行就插一行 placeholder,
// 有行就 noop. 不返回 user — 调用方只关心存在性.
//
// is_admin=true: dev token 等价于管理员 (web-admin/mastra/curl 都靠它), 新库
// 直接把占位行建成 admin, 让 GET /v1/me 在 dev token 模式下也返回 is_admin=true,
// 前端无需为 dev-token 回退做特例. 存量库的 dev 行由迁移 017 补提权.
func (r *Repository) EnsurePlaceholder(ctx context.Context, id uuid.UUID, email string) error {
	const q = `
		INSERT INTO users (id, email, email_lower, password_hash, display_name, is_admin)
		VALUES ($1, $2, $3, '!', 'dev', TRUE)
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

// ────── admin ──────

// IsAdmin 是给 admin 中间件用的轻量查询 — 只取 is_admin 一列, 不拉整行.
// 用户不存在返回 ErrNotFound.
func (r *Repository) IsAdmin(ctx context.Context, id uuid.UUID) (bool, error) {
	const q = `SELECT is_admin FROM users WHERE id = $1`
	var isAdmin bool
	if err := r.pool.QueryRow(ctx, q, id).Scan(&isAdmin); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, ErrNotFound
		}
		return false, fmt.Errorf("lookup is_admin: %w", err)
	}
	return isAdmin, nil
}

// SetAdminByEmail 按邮箱授予/收回 admin. 返回更新后的用户. 找不到返回 ErrNotFound.
// 给 grant-admin 脚本和未来的"管理员管理"用.
func (r *Repository) SetAdminByEmail(ctx context.Context, email string, isAdmin bool) (*User, error) {
	const q = `
		UPDATE users SET is_admin = $2, updated_at = NOW()
		WHERE email_lower = $1
		RETURNING id, email, password_hash, display_name, avatar_url, avatar_object_key, bio, language, is_admin, created_at, updated_at
	`
	row := r.pool.QueryRow(ctx, q, strings.ToLower(strings.TrimSpace(email)), isAdmin)
	u, err := scanUser(row)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("set admin: %w", err)
	}
	return u, nil
}

// UserListRow 是 admin 用户列表的一行: 用户基本信息 + 轻量活动指标.
// signal_count / last_seen_at 让"接入用户"页一眼看出谁活跃, 无需逐个点开.
type UserListRow struct {
	User
	SignalCount int
	LastSeenAt  *time.Time
}

// ListUsers 返回所有用户 (新→旧) + 每人信号数 + 最近一次 session 活动时间.
// 单 host 个人 app, 用户量小, 不分页.
func (r *Repository) ListUsers(ctx context.Context) ([]UserListRow, error) {
	const q = `
		SELECT u.id, u.email, u.password_hash, u.display_name, u.avatar_url, u.avatar_object_key, u.bio, u.language,
		       u.is_admin, u.created_at, u.updated_at,
		       COALESCE(sig.cnt, 0)        AS signal_count,
		       sess.last_seen              AS last_seen_at
		FROM users u
		LEFT JOIN (
			SELECT user_id, COUNT(*) AS cnt FROM signals GROUP BY user_id
		) sig ON sig.user_id = u.id
		LEFT JOIN (
			SELECT user_id, MAX(last_seen_at) AS last_seen FROM sessions GROUP BY user_id
		) sess ON sess.user_id = u.id
		ORDER BY u.created_at DESC
	`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	defer rows.Close()

	var out []UserListRow
	for rows.Next() {
		var row UserListRow
		if err := rows.Scan(
			&row.ID, &row.Email, &row.PasswordHash, &row.DisplayName, &row.AvatarURL, &row.AvatarObjectKey, &row.Bio, &row.Language,
			&row.IsAdmin, &row.CreatedAt, &row.UpdatedAt,
			&row.SignalCount, &row.LastSeenAt,
		); err != nil {
			return nil, fmt.Errorf("scan user row: %w", err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iter users: %w", err)
	}
	return out, nil
}

// ────── stats (个人资料页) ──────

// StatsCounts 是个人资料页的汇总指标 (单条聚合查询的结果).
type StatsCounts struct {
	SignalsTotal   int // 录入信号总数
	SignalsMatured int // 已推演 (inference_status='done')
	GateTotal      int // 过会评估总次数
	GatePassed     int // 四门全过的次数
	Projects       int // 在用分类数 (未归档)
}

// ActivityDay 是某一天 (Asia/Shanghai 日历日) 的活动计数.
type ActivityDay struct {
	Day   time.Time // 当天 00:00 (date), UTC 解析但仅日期部分有意义
	Count int
}

// StatsCounts 取一个用户的汇总指标. 五个子查询合一, 一次往返.
func (r *Repository) StatsCounts(ctx context.Context, userID uuid.UUID) (StatsCounts, error) {
	const q = `
		SELECT
			(SELECT COUNT(*) FROM signals          WHERE user_id = $1)                              AS signals_total,
			(SELECT COUNT(*) FROM signals          WHERE user_id = $1 AND inference_status = 'done') AS signals_matured,
			(SELECT COUNT(*) FROM gate_evaluations WHERE user_id = $1)                              AS gate_total,
			(SELECT COUNT(*) FROM gate_evaluations WHERE user_id = $1 AND passed)                   AS gate_passed,
			(SELECT COUNT(*) FROM projects         WHERE user_id = $1 AND archived_at IS NULL)      AS projects
	`
	var s StatsCounts
	row := r.pool.QueryRow(ctx, q, userID)
	if err := row.Scan(&s.SignalsTotal, &s.SignalsMatured, &s.GateTotal, &s.GatePassed, &s.Projects); err != nil {
		return StatsCounts{}, fmt.Errorf("stats counts: %w", err)
	}
	return s, nil
}

// ActivitySince 返回 since (含) 起每个有活动的「日」的计数, 用于个人资料页的点阵图.
// 口径 = 信号录入 (signals.captured_at) + 过会 (gate_evaluations.evaluated_at), 两者按
// Asia/Shanghai 时区折算成日历日后逐日合并. 只回有活动的日 (稀疏), 空日由前端补 0.
// since 是 Shanghai 日历日的字符串 (YYYY-MM-DD).
func (r *Repository) ActivitySince(ctx context.Context, userID uuid.UUID, since string) ([]ActivityDay, error) {
	const q = `
		SELECT day, SUM(cnt)::int AS total
		FROM (
			SELECT (captured_at  AT TIME ZONE 'Asia/Shanghai')::date AS day, COUNT(*) AS cnt
			  FROM signals
			 WHERE user_id = $1 AND (captured_at  AT TIME ZONE 'Asia/Shanghai')::date >= $2::date
			 GROUP BY 1
			UNION ALL
			SELECT (evaluated_at AT TIME ZONE 'Asia/Shanghai')::date AS day, COUNT(*) AS cnt
			  FROM gate_evaluations
			 WHERE user_id = $1 AND (evaluated_at AT TIME ZONE 'Asia/Shanghai')::date >= $2::date
			 GROUP BY 1
		) t
		GROUP BY day
		ORDER BY day
	`
	rows, err := r.pool.Query(ctx, q, userID, since)
	if err != nil {
		return nil, fmt.Errorf("activity since: %w", err)
	}
	defer rows.Close()

	var out []ActivityDay
	for rows.Next() {
		var d ActivityDay
		if err := rows.Scan(&d.Day, &d.Count); err != nil {
			return nil, fmt.Errorf("scan activity day: %w", err)
		}
		out = append(out, d)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("iter activity: %w", err)
	}
	return out, nil
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
	if err := row.Scan(&u.ID, &u.Email, &u.PasswordHash, &u.DisplayName, &u.AvatarURL, &u.AvatarObjectKey, &u.Bio, &u.Language, &u.IsAdmin, &u.CreatedAt, &u.UpdatedAt); err != nil {
		return nil, err
	}
	return &u, nil
}
