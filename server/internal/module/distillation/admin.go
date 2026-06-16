package distillation

// admin.go — 运营后台跨用户降噪列表 (GET /v1/admin/distillations).
// 本模块原本只有 by-refinement get; 这里新增跨用户 list.

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminDistillationFilter struct {
	UserID *uuid.UUID
	Limit  int
}

type AdminDistillationRow struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	UserEmail       string
	UserDisplayName *string
	RefinementID    uuid.UUID
	Model           string
	HasBeneficiary  bool
	ContentPreview  *string
	CreatedAt       time.Time
}

func (r *Repository) ListAdmin(ctx context.Context, f AdminDistillationFilter) ([]AdminDistillationRow, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	q := `
		SELECT d.id, d.user_id, COALESCE(u.email, ''), u.display_name, d.refinement_id, d.model,
		       (CASE WHEN jsonb_typeof(d.beneficiary) = 'array'
		             THEN jsonb_array_length(d.beneficiary) > 0 ELSE false END) AS has_ben,
		       left(d.distilled_content, 160), d.created_at
		FROM distillations d
		LEFT JOIN users u ON u.id = d.user_id
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND d.user_id = $%d", len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY d.created_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list distillations: %w", err)
	}
	defer rows.Close()

	out := make([]AdminDistillationRow, 0, f.Limit)
	for rows.Next() {
		var d AdminDistillationRow
		if err := rows.Scan(
			&d.ID, &d.UserID, &d.UserEmail, &d.UserDisplayName, &d.RefinementID, &d.Model,
			&d.HasBeneficiary, &d.ContentPreview, &d.CreatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin distillation: %w", err)
		}
		out = append(out, d)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminDistillationDTO struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	UserEmail       string    `json:"user_email"`
	UserDisplayName string    `json:"user_display_name,omitempty"`
	RefinementID    string    `json:"refinement_id"`
	Model           string    `json:"model"`
	HasBeneficiary  bool      `json:"has_beneficiary"`
	ContentPreview  string    `json:"content_preview,omitempty"`
	CreatedAt       time.Time `json:"created_at"`
}

func (h *Handler) adminList(c *gin.Context) {
	var f AdminDistillationFilter
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

	rows, err := h.svc.repo.ListAdmin(c.Request.Context(), f)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]adminDistillationDTO, len(rows))
	for i, d := range rows {
		dto := adminDistillationDTO{
			ID:             d.ID.String(),
			UserID:         d.UserID.String(),
			UserEmail:      d.UserEmail,
			RefinementID:   d.RefinementID.String(),
			Model:          d.Model,
			HasBeneficiary: d.HasBeneficiary,
			CreatedAt:      d.CreatedAt,
		}
		if d.UserDisplayName != nil {
			dto.UserDisplayName = *d.UserDisplayName
		}
		if d.ContentPreview != nil {
			dto.ContentPreview = *d.ContentPreview
		}
		out[i] = dto
	}
	c.JSON(http.StatusOK, gin.H{"distillations": out})
}
