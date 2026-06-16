package refinement

// admin.go — 运营后台跨用户追问会话列表 (GET /v1/admin/refinement/sessions).

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminSessionFilter struct {
	UserID *uuid.UUID
	Status string // "" | active | completed | abandoned
	Limit  int
}

type AdminSessionRow struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	UserEmail       string
	UserDisplayName *string
	Status          string
	RoundsDone      int
	Decision        *string
	PrimaryAsset    *string
	SignalSummary   *string
	StartedAt       time.Time
	CompletedAt     *time.Time
}

func (r *Repository) ListAdmin(ctx context.Context, f AdminSessionFilter) ([]AdminSessionRow, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	q := `
		SELECT rs.id, rs.user_id, COALESCE(u.email, ''), u.display_name,
		       rs.status, rs.rounds_done, rs.decision, rs.primary_asset,
		       s.inference_summary, rs.started_at, rs.completed_at
		FROM refinement_sessions rs
		LEFT JOIN users u ON u.id = rs.user_id
		LEFT JOIN signals s ON s.id = rs.primary_signal_id
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND rs.user_id = $%d", len(args))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		q += fmt.Sprintf(" AND rs.status = $%d", len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY rs.started_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list sessions: %w", err)
	}
	defer rows.Close()

	out := make([]AdminSessionRow, 0, f.Limit)
	for rows.Next() {
		var s AdminSessionRow
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.UserEmail, &s.UserDisplayName,
			&s.Status, &s.RoundsDone, &s.Decision, &s.PrimaryAsset,
			&s.SignalSummary, &s.StartedAt, &s.CompletedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin session: %w", err)
		}
		out = append(out, s)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminSessionDTO struct {
	ID              string     `json:"id"`
	UserID          string     `json:"user_id"`
	UserEmail       string     `json:"user_email"`
	UserDisplayName string     `json:"user_display_name,omitempty"`
	Status          string     `json:"status"`
	RoundsDone      int        `json:"rounds_done"`
	Decision        string     `json:"decision,omitempty"`
	PrimaryAsset    string     `json:"primary_asset,omitempty"`
	SignalSummary   string     `json:"signal_summary,omitempty"`
	StartedAt       time.Time  `json:"started_at"`
	CompletedAt     *time.Time `json:"completed_at,omitempty"`
}

func (h *Handler) adminList(c *gin.Context) {
	var f AdminSessionFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	switch st := c.Query("status"); st {
	case "", "active", "completed", "abandoned":
		f.Status = st
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be active|completed|abandoned"})
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
	out := make([]adminSessionDTO, len(rows))
	for i, s := range rows {
		d := adminSessionDTO{
			ID:          s.ID.String(),
			UserID:      s.UserID.String(),
			UserEmail:   s.UserEmail,
			Status:      s.Status,
			RoundsDone:  s.RoundsDone,
			StartedAt:   s.StartedAt,
			CompletedAt: s.CompletedAt,
		}
		if s.UserDisplayName != nil {
			d.UserDisplayName = *s.UserDisplayName
		}
		if s.Decision != nil {
			d.Decision = *s.Decision
		}
		if s.PrimaryAsset != nil {
			d.PrimaryAsset = *s.PrimaryAsset
		}
		if s.SignalSummary != nil {
			d.SignalSummary = *s.SignalSummary
		}
		out[i] = d
	}
	c.JSON(http.StatusOK, gin.H{"sessions": out})
}
