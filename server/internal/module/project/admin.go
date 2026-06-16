package project

// admin.go — 运营后台跨用户项目/分类列表 (GET /v1/admin/projects).

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminProjectFilter struct {
	UserID          *uuid.UUID
	IncludeArchived bool
	Limit           int
}

type AdminProjectRow struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	UserEmail       string
	UserDisplayName *string
	Name            string
	Emoji           *string
	Archived        bool
	SignalCount     int
	CreatedAt       time.Time
}

func (r *Repository) ListAdmin(ctx context.Context, f AdminProjectFilter) ([]AdminProjectRow, error) {
	if f.Limit <= 0 || f.Limit > 500 {
		f.Limit = 200
	}
	q := `
		SELECT p.id, p.user_id, COALESCE(u.email, ''), u.display_name, p.name, p.emoji,
		       (p.archived_at IS NOT NULL) AS archived,
		       (SELECT count(*) FROM signals WHERE project_id = p.id),
		       p.created_at
		FROM projects p
		LEFT JOIN users u ON u.id = p.user_id
		WHERE 1=1`
	args := []any{}
	if !f.IncludeArchived {
		q += " AND p.archived_at IS NULL"
	}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND p.user_id = $%d", len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY p.created_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list projects: %w", err)
	}
	defer rows.Close()

	out := make([]AdminProjectRow, 0, f.Limit)
	for rows.Next() {
		var p AdminProjectRow
		if err := rows.Scan(
			&p.ID, &p.UserID, &p.UserEmail, &p.UserDisplayName, &p.Name, &p.Emoji,
			&p.Archived, &p.SignalCount, &p.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin project: %w", err)
		}
		out = append(out, p)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminProjectDTO struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	UserEmail       string    `json:"user_email"`
	UserDisplayName string    `json:"user_display_name,omitempty"`
	Name            string    `json:"name"`
	Emoji           string    `json:"emoji,omitempty"`
	Archived        bool      `json:"archived"`
	SignalCount     int       `json:"signal_count"`
	CreatedAt       time.Time `json:"created_at"`
}

func (h *Handler) adminList(c *gin.Context) {
	var f AdminProjectFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	f.IncludeArchived = c.Query("include_archived") == "true"
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
	out := make([]adminProjectDTO, len(rows))
	for i, p := range rows {
		dto := adminProjectDTO{
			ID:          p.ID.String(),
			UserID:      p.UserID.String(),
			UserEmail:   p.UserEmail,
			Name:        p.Name,
			Archived:    p.Archived,
			SignalCount: p.SignalCount,
			CreatedAt:   p.CreatedAt,
		}
		if p.UserDisplayName != nil {
			dto.UserDisplayName = *p.UserDisplayName
		}
		if p.Emoji != nil {
			dto.Emoji = *p.Emoji
		}
		out[i] = dto
	}
	c.JSON(http.StatusOK, gin.H{"projects": out})
}
