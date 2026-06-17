package commitment

// admin.go — 运营后台跨用户持仓列表 (GET /v1/admin/holdings).
// 复用用户域 ListHoldings 的 thesis JOIN 取 ticker/action, 加 join users 带邮箱.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminHoldingFilter struct {
	UserID *uuid.UUID
	Status string // "" | active | triggered | expired | closed | archived
	Limit  int
}

type AdminHoldingRow struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	UserEmail       string
	UserDisplayName *string
	Status          string
	Ticker          *string
	Action          *string
	SignedAt        time.Time
	ExpiresAt       time.Time
	TriggeredAt     *time.Time
	ClosedAt        *time.Time
	ArchivedAt      *time.Time
}

func (r *Repository) ListHoldingsAdmin(ctx context.Context, f AdminHoldingFilter) ([]AdminHoldingRow, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	q := `
		SELECT h.id, h.user_id, COALESCE(u.email, ''), u.display_name, h.status,
		       c.thesis->>'asset_ticker', c.thesis->>'action',
		       h.signed_at, h.expires_at, h.triggered_at, h.closed_at, h.archived_at
		FROM holdings h
		JOIN commitments c ON c.id = h.id
		LEFT JOIN users u ON u.id = h.user_id
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND h.user_id = $%d", len(args))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		q += fmt.Sprintf(" AND h.status = $%d", len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY h.signed_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list holdings: %w", err)
	}
	defer rows.Close()

	out := make([]AdminHoldingRow, 0, f.Limit)
	for rows.Next() {
		var h AdminHoldingRow
		if err := rows.Scan(
			&h.ID, &h.UserID, &h.UserEmail, &h.UserDisplayName, &h.Status,
			&h.Ticker, &h.Action,
			&h.SignedAt, &h.ExpiresAt, &h.TriggeredAt, &h.ClosedAt, &h.ArchivedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin holding: %w", err)
		}
		out = append(out, h)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminHoldingDTO struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	UserEmail       string     `json:"user_email"`
	UserDisplayName string     `json:"user_display_name,omitempty"`
	Status          string     `json:"status"`
	Ticker          string     `json:"ticker,omitempty"`
	Action          string     `json:"action,omitempty"`
	SignedAt        time.Time  `json:"signed_at"`
	ExpiresAt       time.Time  `json:"expires_at"`
	TriggeredAt     *time.Time `json:"triggered_at,omitempty"`
	ClosedAt        *time.Time `json:"closed_at,omitempty"`
	ArchivedAt      *time.Time `json:"archived_at,omitempty"`
}

// adminListHoldings GET /v1/admin/holdings — 跨用户持仓 (新→旧). 过滤: user_id/status/limit.
func (h *Handler) adminListHoldings(c *gin.Context) {
	var f AdminHoldingFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	switch st := c.Query("status"); st {
	case "", "active", "triggered", "expired", "closed", "archived":
		f.Status = st
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown status"})
		return
	}
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			f.Limit = n
		}
	}

	rows, err := h.svc.repo.ListHoldingsAdmin(c.Request.Context(), f)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]adminHoldingDTO, len(rows))
	for i, h := range rows {
		d := adminHoldingDTO{
			ID:          h.ID.String(),
			UserID:      h.UserID.String(),
			UserEmail:   h.UserEmail,
			Status:      h.Status,
			SignedAt:    h.SignedAt,
			ExpiresAt:   h.ExpiresAt,
			TriggeredAt: h.TriggeredAt,
			ClosedAt:    h.ClosedAt,
			ArchivedAt:  h.ArchivedAt,
		}
		if h.UserDisplayName != nil {
			d.UserDisplayName = *h.UserDisplayName
		}
		if h.Ticker != nil {
			d.Ticker = *h.Ticker
		}
		if h.Action != nil {
			d.Action = *h.Action
		}
		out[i] = d
	}
	c.JSON(http.StatusOK, gin.H{"holdings": out})
}
