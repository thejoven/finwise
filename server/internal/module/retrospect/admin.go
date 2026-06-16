package retrospect

// admin.go — 运营后台跨用户复盘列表 (GET /v1/admin/retrospects).

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminRetrospectFilter struct {
	UserID *uuid.UUID
	State  string // "" | pending | answered | finalized
	Limit  int
}

type AdminRetrospectRow struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	UserEmail       string
	UserDisplayName *string
	State           string
	FocusDim        *string
	StartedAt       time.Time
	FinalizedAt     *time.Time
}

func (r *Repository) ListAdmin(ctx context.Context, f AdminRetrospectFilter) ([]AdminRetrospectRow, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	q := `
		SELECT r.id, r.user_id, COALESCE(u.email, ''), u.display_name,
		       r.state, r.focus_dim, r.started_at, r.finalized_at
		FROM retrospects r
		LEFT JOIN users u ON u.id = r.user_id
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND r.user_id = $%d", len(args))
	}
	if f.State != "" {
		args = append(args, f.State)
		q += fmt.Sprintf(" AND r.state = $%d", len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY r.started_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list retrospects: %w", err)
	}
	defer rows.Close()

	out := make([]AdminRetrospectRow, 0, f.Limit)
	for rows.Next() {
		var rt AdminRetrospectRow
		if err := rows.Scan(
			&rt.ID, &rt.UserID, &rt.UserEmail, &rt.UserDisplayName,
			&rt.State, &rt.FocusDim, &rt.StartedAt, &rt.FinalizedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin retrospect: %w", err)
		}
		out = append(out, rt)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminRetrospectDTO struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	UserEmail       string     `json:"user_email"`
	UserDisplayName string     `json:"user_display_name,omitempty"`
	State           string     `json:"state"`
	FocusDim        string     `json:"focus_dim,omitempty"`
	StartedAt       time.Time  `json:"started_at"`
	FinalizedAt     *time.Time `json:"finalized_at,omitempty"`
}

func (h *Handler) adminList(c *gin.Context) {
	var f AdminRetrospectFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	switch st := c.Query("state"); st {
	case "", "pending", "answered", "finalized":
		f.State = st
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "state must be pending|answered|finalized"})
		return
	}
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			f.Limit = n
		}
	}

	rows, err := h.svc.repo.ListAdmin(c.Request.Context(), f)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]adminRetrospectDTO, len(rows))
	for i, rt := range rows {
		dto := adminRetrospectDTO{
			ID:          rt.ID.String(),
			UserID:      rt.UserID.String(),
			UserEmail:   rt.UserEmail,
			State:       rt.State,
			StartedAt:   rt.StartedAt,
			FinalizedAt: rt.FinalizedAt,
		}
		if rt.UserDisplayName != nil {
			dto.UserDisplayName = *rt.UserDisplayName
		}
		if rt.FocusDim != nil {
			dto.FocusDim = *rt.FocusDim
		}
		out[i] = dto
	}
	c.JSON(http.StatusOK, gin.H{"retrospects": out})
}
