package signal

// admin.go — 运营后台跨用户信号列表 (GET /v1/admin/signals).
// 与用户域 list 的区别: 不按 user_id 锁定 (可选过滤), join users 带出归属邮箱.
// 挂在 adminV1 (RequireAdmin), 故无 ownership 校验.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminSignalFilter struct {
	UserID    *uuid.UUID
	Status    string // "" | pending | done | failed
	ProjectID *uuid.UUID
	Query     string
	Before    *time.Time // captured_at 游标
	Limit     int
}

type AdminSignalRow struct {
	ID               uuid.UUID
	UserID           uuid.UUID
	UserEmail        string
	UserDisplayName  *string
	ProjectID        *uuid.UUID
	ProjectName      *string
	RawText          string
	CapturedAt       time.Time
	InferenceStatus  string
	InferenceSummary *string
	InferenceTags    []string
}

func (r *Repository) ListAdmin(ctx context.Context, f AdminSignalFilter) ([]AdminSignalRow, bool, error) {
	if f.Limit <= 0 || f.Limit > 100 {
		f.Limit = 30
	}
	limit := f.Limit + 1 // +1 探测 has_more

	q := `
		SELECT s.id, s.user_id, COALESCE(u.email, ''), u.display_name,
		       s.project_id, p.name,
		       s.raw_text, s.captured_at, s.inference_status, s.inference_summary, s.inference_tags
		FROM signals s
		LEFT JOIN users u ON u.id = s.user_id
		LEFT JOIN projects p ON p.id = s.project_id
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND s.user_id = $%d", len(args))
	}
	if f.Status != "" {
		args = append(args, f.Status)
		q += fmt.Sprintf(" AND s.inference_status = $%d", len(args))
	}
	if f.ProjectID != nil {
		args = append(args, *f.ProjectID)
		q += fmt.Sprintf(" AND s.project_id = $%d", len(args))
	}
	if f.Query != "" {
		args = append(args, "%"+escapeLike(f.Query)+"%")
		q += fmt.Sprintf(" AND (s.raw_text ILIKE $%d OR COALESCE(s.inference_summary, '') ILIKE $%d)", len(args), len(args))
	}
	if f.Before != nil {
		args = append(args, *f.Before)
		q += fmt.Sprintf(" AND s.captured_at < $%d", len(args))
	}
	args = append(args, limit)
	q += fmt.Sprintf(" ORDER BY s.captured_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, false, fmt.Errorf("admin list signals: %w", err)
	}
	defer rows.Close()

	out := make([]AdminSignalRow, 0, limit)
	for rows.Next() {
		var s AdminSignalRow
		if err := rows.Scan(
			&s.ID, &s.UserID, &s.UserEmail, &s.UserDisplayName,
			&s.ProjectID, &s.ProjectName,
			&s.RawText, &s.CapturedAt, &s.InferenceStatus, &s.InferenceSummary, &s.InferenceTags,
		); err != nil {
			return nil, false, fmt.Errorf("scan admin signal: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, false, fmt.Errorf("rows iter: %w", err)
	}

	hasMore := len(out) > f.Limit
	if hasMore {
		out = out[:f.Limit]
	}
	return out, hasMore, nil
}

// ───── handler ─────

type adminSignalDTO struct {
	ID               string    `json:"id"`
	UserID           string    `json:"user_id"`
	UserEmail        string    `json:"user_email"`
	UserDisplayName  string    `json:"user_display_name,omitempty"`
	ProjectID        string    `json:"project_id,omitempty"`
	ProjectName      string    `json:"project_name,omitempty"`
	RawText          string    `json:"raw_text"`
	CapturedAt       time.Time `json:"captured_at"`
	InferenceStatus  string    `json:"inference_status"`
	InferenceSummary string    `json:"inference_summary,omitempty"`
	InferenceTags    []string  `json:"inference_tags,omitempty"`
}

type adminListResponse struct {
	Signals []adminSignalDTO `json:"signals"`
	HasMore bool             `json:"has_more"`
}

// adminList GET /v1/admin/signals — 跨用户信号 (新→旧). 过滤: user_id/status/project_id/q/before/limit.
func (h *Handler) adminList(c *gin.Context) {
	var f AdminSignalFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	switch st := c.Query("status"); st {
	case "", "pending", "done", "failed":
		f.Status = st
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "status must be pending|done|failed"})
		return
	}
	if s := c.Query("project_id"); s != "" {
		pid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project_id not a uuid"})
			return
		}
		f.ProjectID = &pid
	}
	f.Query = c.Query("q")
	if s := c.Query("before"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "before not RFC3339"})
			return
		}
		f.Before = &t
	}
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			f.Limit = n
		}
	}

	rows, hasMore, err := h.svc.repo.ListAdmin(c.Request.Context(), f)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]adminSignalDTO, len(rows))
	for i, s := range rows {
		d := adminSignalDTO{
			ID:              s.ID.String(),
			UserID:          s.UserID.String(),
			UserEmail:       s.UserEmail,
			RawText:         s.RawText,
			CapturedAt:      s.CapturedAt,
			InferenceStatus: s.InferenceStatus,
			InferenceTags:   s.InferenceTags,
		}
		if s.UserDisplayName != nil {
			d.UserDisplayName = *s.UserDisplayName
		}
		if s.ProjectID != nil {
			d.ProjectID = s.ProjectID.String()
		}
		if s.ProjectName != nil {
			d.ProjectName = *s.ProjectName
		}
		if s.InferenceSummary != nil {
			d.InferenceSummary = *s.InferenceSummary
		}
		out[i] = d
	}
	c.JSON(http.StatusOK, adminListResponse{Signals: out, HasMore: hasMore})
}
