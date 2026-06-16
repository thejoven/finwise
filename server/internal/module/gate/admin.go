package gate

// admin.go — 运营后台跨用户投决评估列表 (GET /v1/admin/gate/evaluations).
// lean 行 (不带 gates_detail / 信号上下文; 列表只看 pass/fail/pool, 详情走 /:id).

import (
	"context"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type AdminEvalFilter struct {
	UserID *uuid.UUID
	Passed *bool
	Pool   string // "" | observation | lesson | calendar | discard
	Limit  int
}

type AdminEvalRow struct {
	ID              uuid.UUID
	UserID          uuid.UUID
	UserEmail       string
	UserDisplayName *string
	RefinementID    uuid.UUID
	Passed          bool
	FailedGate      *int
	ArchivedPool    *string
	EvaluatedAt     time.Time
}

func (r *Repository) ListAdmin(ctx context.Context, f AdminEvalFilter) ([]AdminEvalRow, error) {
	if f.Limit <= 0 || f.Limit > 200 {
		f.Limit = 100
	}
	q := `
		SELECT ge.id, ge.user_id, COALESCE(u.email, ''), u.display_name,
		       ge.refinement_id, ge.passed, ge.failed_gate, ge.archived_pool, ge.evaluated_at
		FROM gate_evaluations ge
		LEFT JOIN users u ON u.id = ge.user_id
		WHERE 1=1`
	args := []any{}
	if f.UserID != nil {
		args = append(args, *f.UserID)
		q += fmt.Sprintf(" AND ge.user_id = $%d", len(args))
	}
	if f.Passed != nil {
		args = append(args, *f.Passed)
		q += fmt.Sprintf(" AND ge.passed = $%d", len(args))
	}
	if f.Pool != "" {
		args = append(args, f.Pool)
		q += fmt.Sprintf(" AND ge.archived_pool = $%d", len(args))
	}
	args = append(args, f.Limit)
	q += fmt.Sprintf(" ORDER BY ge.evaluated_at DESC LIMIT $%d", len(args))

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list evaluations: %w", err)
	}
	defer rows.Close()

	out := make([]AdminEvalRow, 0, f.Limit)
	for rows.Next() {
		var e AdminEvalRow
		if err := rows.Scan(
			&e.ID, &e.UserID, &e.UserEmail, &e.UserDisplayName,
			&e.RefinementID, &e.Passed, &e.FailedGate, &e.ArchivedPool, &e.EvaluatedAt,
		); err != nil {
			return nil, fmt.Errorf("scan admin evaluation: %w", err)
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// ───── handler ─────

type adminEvalDTO struct {
	ID              string    `json:"id"`
	UserID          string    `json:"user_id"`
	UserEmail       string    `json:"user_email"`
	UserDisplayName string    `json:"user_display_name,omitempty"`
	RefinementID    string    `json:"refinement_id"`
	Passed          bool      `json:"passed"`
	FailedGate      *int      `json:"failed_gate,omitempty"`
	ArchivedPool    string    `json:"archived_pool,omitempty"`
	EvaluatedAt     time.Time `json:"evaluated_at"`
}

// adminList GET /v1/admin/gate/evaluations — 跨用户评估 (新→旧). 过滤: user_id/passed/pool/limit.
func (h *Handler) adminList(c *gin.Context) {
	var f AdminEvalFilter
	if s := c.Query("user_id"); s != "" {
		uid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		f.UserID = &uid
	}
	switch p := c.Query("passed"); p {
	case "true":
		v := true
		f.Passed = &v
	case "false":
		v := false
		f.Passed = &v
	case "":
		// 不过滤
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "passed must be true|false"})
		return
	}
	switch pool := c.Query("pool"); pool {
	case "", "observation", "lesson", "calendar", "discard":
		f.Pool = pool
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown pool"})
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
	out := make([]adminEvalDTO, len(rows))
	for i, e := range rows {
		d := adminEvalDTO{
			ID:           e.ID.String(),
			UserID:       e.UserID.String(),
			UserEmail:    e.UserEmail,
			RefinementID: e.RefinementID.String(),
			Passed:       e.Passed,
			FailedGate:   e.FailedGate,
			EvaluatedAt:  e.EvaluatedAt,
		}
		if e.UserDisplayName != nil {
			d.UserDisplayName = *e.UserDisplayName
		}
		if e.ArchivedPool != nil {
			d.ArchivedPool = *e.ArchivedPool
		}
		out[i] = d
	}
	c.JSON(http.StatusOK, gin.H{"evaluations": out})
}
