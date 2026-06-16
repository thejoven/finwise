package subscription

// admin.go — 运营后台跨用户订阅源视图 (GET /v1/admin/subscriptions).
// 与用户域 per-subscription 不同, 这里是 per-account 运营视图: 每个 X 账号 + 订阅人数
// + 推文数 + 轮询状态. 可选 user_id 过滤到某用户订阅的账号 (「聚焦到用户」drill).

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminAccountFilter struct {
	UserID *uuid.UUID
	Limit  int
}

type AdminAccountRow struct {
	ID              uuid.UUID
	Handle          string
	DisplayName     *string
	Status          string
	LastPolledAt    *time.Time
	PollIntervalSec int
	SubscriberCount int
	TweetCount      int
}

func (r *Repository) ListAccountsAdmin(ctx context.Context, f AdminAccountFilter) ([]AdminAccountRow, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 100
	}
	q := `
		SELECT a.id, a.handle, a.display_name, a.status, a.last_polled_at, a.poll_interval_sec,
		       (SELECT count(*) FROM subscriptions s
		         WHERE s.source_id = a.id AND s.source_type = 'twitter' AND s.active),
		       (SELECT count(*) FROM tweets t WHERE t.twitter_account_id = a.id)
		FROM twitter_accounts a
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(`
			AND EXISTS (SELECT 1 FROM subscriptions s
			            WHERE s.source_id = a.id AND s.source_type = 'twitter'
			              AND s.active AND s.user_id = $%d)`, len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY a.last_polled_at DESC NULLS LAST LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list accounts: %w", err)
	}
	defer rows.Close()

	out := make([]AdminAccountRow, 0, f.Limit)
	for rows.Next() {
		var a AdminAccountRow
		if err := rows.Scan(
			&a.ID, &a.Handle, &a.DisplayName, &a.Status, &a.LastPolledAt, &a.PollIntervalSec,
			&a.SubscriberCount, &a.TweetCount,
		); err != nil {
			return nil, fmt.Errorf("scan admin account: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminAccountDTO struct {
	ID              string     `json:"id"`
	Handle          string     `json:"handle"`
	DisplayName     string     `json:"display_name,omitempty"`
	Status          string     `json:"status"`
	LastPolledAt    *time.Time `json:"last_polled_at,omitempty"`
	PollIntervalSec int        `json:"poll_interval_sec"`
	SubscriberCount int        `json:"subscriber_count"`
	TweetCount      int        `json:"tweet_count"`
}

// adminListAccounts GET /v1/admin/subscriptions — 跨用户订阅源 (按账号). 过滤: user_id/limit.
func (h *Handler) adminListAccounts(c *gin.Context) {
	var f AdminAccountFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			f.Limit = n
		}
	}

	rows, err := h.svc.repo.ListAccountsAdmin(c.Request.Context(), f)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]adminAccountDTO, len(rows))
	for i, a := range rows {
		d := adminAccountDTO{
			ID:              a.ID.String(),
			Handle:          a.Handle,
			Status:          a.Status,
			LastPolledAt:    a.LastPolledAt,
			PollIntervalSec: a.PollIntervalSec,
			SubscriberCount: a.SubscriberCount,
			TweetCount:      a.TweetCount,
		}
		if a.DisplayName != nil {
			d.DisplayName = *a.DisplayName
		}
		out[i] = d
	}
	c.JSON(http.StatusOK, gin.H{"accounts": out})
}
