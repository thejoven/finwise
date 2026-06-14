package db

import (
	"context"

	"github.com/google/uuid"
)

// UserLanguage 取用户语言偏好 ('zh-Hans' | 'zh-Hant' | 'en').
// 查不到 / 未设置 (NULL) / 出错一律返回 "" —— 调用方把空串传给 Mastra, agent 按默认简体处理.
// best-effort: 语言偏好非关键路径, 不为它阻断 AI 生成. 各模块跨表只读 users.language 用它,
// 省得每个 repo 重复同一句 SELECT.
func UserLanguage(ctx context.Context, pool *Pool, userID uuid.UUID) string {
	var lang *string
	if err := pool.QueryRow(ctx, `SELECT language FROM users WHERE id = $1`, userID).Scan(&lang); err != nil || lang == nil {
		return ""
	}
	return *lang
}
