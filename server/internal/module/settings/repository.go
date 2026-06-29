// Package settings 持有后台可配的运行时设置 (app_settings 通用 key-value 表).
//
// 与 config (纯 env, 启动时加载) 互补: 这里放需要运营在后台随时改、且要持久化的配置
// (当前: 对象存储 R2 凭证). 值以 JSON 落库, 服务层带进程内缓存 + 写时失效.
package settings

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"

	"alphax/server/internal/infra/db"
)

// ErrNotFound 表示该 key 尚未写过 (调用方按需回退默认值).
var ErrNotFound = errors.New("setting not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// Get 取某 key 的 JSON 值. 不存在返回 ErrNotFound.
func (r *Repository) Get(ctx context.Context, key string) (json.RawMessage, error) {
	const q = `SELECT value FROM app_settings WHERE key = $1`
	var raw []byte
	if err := r.pool.QueryRow(ctx, q, key).Scan(&raw); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get setting %q: %w", key, err)
	}
	return json.RawMessage(raw), nil
}

// Upsert 写 key 的 JSON 值 (插入或覆盖).
func (r *Repository) Upsert(ctx context.Context, key string, value json.RawMessage) error {
	const q = `
		INSERT INTO app_settings (key, value, updated_at)
		VALUES ($1, $2, NOW())
		ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()
	`
	if _, err := r.pool.Exec(ctx, q, key, []byte(value)); err != nil {
		return fmt.Errorf("upsert setting %q: %w", key, err)
	}
	return nil
}
