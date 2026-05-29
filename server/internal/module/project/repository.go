// Package project 是"分类/项目"模块.
//
// 用户在 mobile 上把不同关注主题 (如 "泡泡玛特" "新能源") 建成独立 project,
// 此后 capture 时绑定 project_id, 统计页按 project_id 过滤数据分析.
//
// 真相只在 signals.project_id 一份, 不冗余到 refinement / attention —— 那两层
// 走 JOIN signals 过滤. 这样新增一条 signal 就够, 不会失同步.
package project

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"

	"flashfi/server/internal/infra/db"
)

var (
	ErrNotFound      = errors.New("project not found")
	ErrDuplicateName = errors.New("project name already exists")
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Project — 一个分类行.
type Project struct {
	ID         uuid.UUID
	UserID     uuid.UUID
	Name       string
	Color      *string
	Emoji      *string
	SortOrder  int
	ArchivedAt *time.Time
	CreatedAt  time.Time
	UpdatedAt  time.Time
}

type CreateInput struct {
	UserID    uuid.UUID
	Name      string
	Color     *string
	Emoji     *string
	SortOrder int
}

type UpdateInput struct {
	UserID    uuid.UUID
	ID        uuid.UUID
	Name      *string
	Color     *string // 显式 nil 不动; 空字符串 = 清空 → 由 service 转 nil 不行, 故用 *string + sentinel
	Emoji     *string
	SortOrder *int
}

// Create 写一行. unique (user_id, name) WHERE archived_at IS NULL 命中转 ErrDuplicateName.
func (r *Repository) Create(ctx context.Context, in CreateInput) (*Project, error) {
	const q = `
		INSERT INTO projects (user_id, name, color, emoji, sort_order)
		VALUES ($1, $2, $3, $4, $5)
		RETURNING id, created_at, updated_at
	`
	var p Project
	p.UserID = in.UserID
	p.Name = in.Name
	p.Color = in.Color
	p.Emoji = in.Emoji
	p.SortOrder = in.SortOrder
	err := r.pool.QueryRow(ctx, q,
		in.UserID, in.Name, in.Color, in.Emoji, in.SortOrder,
	).Scan(&p.ID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrDuplicateName
		}
		return nil, fmt.Errorf("insert project: %w", err)
	}
	return &p, nil
}

// ListActive 拉某 user 的未归档分类, 按 sort_order + created_at 排序.
func (r *Repository) ListActive(ctx context.Context, userID uuid.UUID) ([]Project, error) {
	const q = `
		SELECT id, user_id, name, color, emoji, sort_order, archived_at, created_at, updated_at
		FROM projects
		WHERE user_id = $1 AND archived_at IS NULL
		ORDER BY sort_order ASC, created_at ASC
	`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("query projects: %w", err)
	}
	defer rows.Close()
	out := make([]Project, 0)
	for rows.Next() {
		var p Project
		if err := rows.Scan(
			&p.ID, &p.UserID, &p.Name, &p.Color, &p.Emoji,
			&p.SortOrder, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan project: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// Get 拿单个 project, 强制 user_id 匹配. 不区分归档 — 调用方按需判断.
func (r *Repository) Get(ctx context.Context, userID, id uuid.UUID) (*Project, error) {
	const q = `
		SELECT id, user_id, name, color, emoji, sort_order, archived_at, created_at, updated_at
		FROM projects
		WHERE user_id = $1 AND id = $2
	`
	var p Project
	err := r.pool.QueryRow(ctx, q, userID, id).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Color, &p.Emoji,
		&p.SortOrder, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get project: %w", err)
	}
	return &p, nil
}

// Update 部分字段更新. 所有指针 == nil 表示不动.
func (r *Repository) Update(ctx context.Context, in UpdateInput) (*Project, error) {
	const q = `
		UPDATE projects SET
			name       = COALESCE($3, name),
			color      = CASE WHEN $4::text IS NOT NULL THEN $4 ELSE color END,
			emoji      = CASE WHEN $5::text IS NOT NULL THEN $5 ELSE emoji END,
			sort_order = COALESCE($6, sort_order),
			updated_at = NOW()
		WHERE user_id = $1 AND id = $2
		RETURNING id, user_id, name, color, emoji, sort_order, archived_at, created_at, updated_at
	`
	var p Project
	err := r.pool.QueryRow(ctx, q,
		in.UserID, in.ID,
		in.Name, in.Color, in.Emoji, in.SortOrder,
	).Scan(
		&p.ID, &p.UserID, &p.Name, &p.Color, &p.Emoji,
		&p.SortOrder, &p.ArchivedAt, &p.CreatedAt, &p.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return nil, ErrDuplicateName
		}
		return nil, fmt.Errorf("update project: %w", err)
	}
	return &p, nil
}

// Archive 软删除 — 不动 signals 上已经绑的 project_id (历史归档保留).
// 重复归档幂等返回当前行.
func (r *Repository) Archive(ctx context.Context, userID, id uuid.UUID) error {
	const q = `
		UPDATE projects SET
			archived_at = NOW(),
			updated_at  = NOW()
		WHERE user_id = $1 AND id = $2 AND archived_at IS NULL
	`
	tag, err := r.pool.Exec(ctx, q, userID, id)
	if err != nil {
		return fmt.Errorf("archive project: %w", err)
	}
	if tag.RowsAffected() == 0 {
		// 不存在 or 已归档. 用 Get 区分.
		p, gerr := r.Get(ctx, userID, id)
		if gerr != nil {
			return gerr // ErrNotFound or other
		}
		// 已归档 — 幂等成功.
		_ = p
	}
	return nil
}

// Exists 判断给定 project_id 是否属于 user 且未归档. signal capture 时校验.
func (r *Repository) Exists(ctx context.Context, userID, id uuid.UUID) (bool, error) {
	const q = `
		SELECT 1 FROM projects
		WHERE user_id = $1 AND id = $2 AND archived_at IS NULL
	`
	var one int
	err := r.pool.QueryRow(ctx, q, userID, id).Scan(&one)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("exists project: %w", err)
	}
	return true, nil
}
