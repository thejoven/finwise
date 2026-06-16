package signal

// admin.go — 运营后台跨用户信号列表 (GET /v1/admin/signals).
// 与用户域 list 的区别: 不按 user_id 锁定 (可选过滤), join users 带出归属邮箱.
// 挂在 adminV1 (RequireAdmin), 故无 ownership 校验.

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"wiseflow/server/internal/domain"
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

// ───── 运营按需重推 (POST /v1/admin/signals/:id/reinfer · POST /v1/admin/signals/reinfer) ─────
//
// 信号已有 recovery sweeper 自动复活卡住的推断 (migration 027 + recovery 模块); 这里是
// 给「按需 / recovery_exhausted 兜底」的手动重推. 复用用户域同一条链路 —— Reinfer 经
// EnqueueReinferOutbox 复用 source_event_id 重发 signal.captured 进 NATS, mastra 重跑
// analyst. 与用户域唯一区别: 不按 user_id 校验 ownership (运营跨用户).

// GetAny 跨用户按 id 取信号 (无 user 过滤). 用户域 Get 会 WHERE user_id; 运营重推不校验
// 归属, 故单开一个. 无行 → ErrNotFound.
func (r *Repository) GetAny(ctx context.Context, id uuid.UUID) (*domain.Signal, error) {
	const q = `
		SELECT id, user_id, project_id, project_auto_assigned, raw_text, captured_at, source_event_id,
		       inference_status, inference_summary, inference_tags,
		       inference_model, inference_done_at, inference_related_assets,
		       created_at, updated_at
		FROM signals
		WHERE id = $1
	`
	s, err := scanSignal(r.pool.QueryRow(ctx, q, id))
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("admin get signal: %w", err)
	}
	return s, nil
}

// ListFailedForReinfer 加载 inference_status='failed' 的信号 (可选按 user 收窄), 取全字段
// 以便 EnqueueReinferOutbox 重投. 不分页 —— 失败集应很小; 仍加 500 cap 防病态全表扫.
func (r *Repository) ListFailedForReinfer(ctx context.Context, userID *uuid.UUID) ([]*domain.Signal, error) {
	q := `
		SELECT id, user_id, project_id, project_auto_assigned, raw_text, captured_at, source_event_id,
		       inference_status, inference_summary, inference_tags,
		       inference_model, inference_done_at, inference_related_assets,
		       created_at, updated_at
		FROM signals
		WHERE inference_status = 'failed'`
	args := []any{}
	if userID != nil {
		args = append(args, *userID)
		q += fmt.Sprintf(" AND user_id = $%d", len(args))
	}
	q += " ORDER BY captured_at ASC LIMIT 500"

	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, fmt.Errorf("admin list failed signals: %w", err)
	}
	defer rows.Close()
	out := make([]*domain.Signal, 0)
	for rows.Next() {
		s, err := scanSignal(rows)
		if err != nil {
			return nil, fmt.Errorf("scan failed signal: %w", err)
		}
		out = append(out, s)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("rows iter: %w", err)
	}
	return out, nil
}

// ───── service ─────

// AdminReinfer 运营按需重推单条 (跨用户, 不校验 ownership). 复用 EnqueueReinferOutbox.
// 已 done → ErrInferenceDone: 推演回写在 event 层用 signal_id 派生的 SHA1 幂等键去重,
// 重投 done 信号是 no-op, 拒绝比假装成功更诚实. 不存在 → ErrNotFound.
func (s *Service) AdminReinfer(ctx context.Context, signalID uuid.UUID) (*domain.Signal, error) {
	sig, err := s.repo.GetAny(ctx, signalID)
	if err != nil {
		return nil, err
	}
	if sig.InferenceStatus == domain.InferenceStatusDone {
		return nil, ErrInferenceDone
	}
	if err := s.repo.EnqueueReinferOutbox(ctx, sig); err != nil {
		return nil, fmt.Errorf("enqueue reinfer: %w", err)
	}
	return sig, nil
}

// AdminReinferFailed 批量重推全部 failed 信号 (可选按 user). 逐条复用 EnqueueReinferOutbox
// (沿用其"未分类/provisional 下发候选分类"逻辑), 返回实际入队条数. 中途某条失败即停并
// 返回已入队数 + err —— 已写入的 outbox 行不回滚 (各自独立, 重复入队也幂等无害).
func (s *Service) AdminReinferFailed(ctx context.Context, userID *uuid.UUID) (int, error) {
	sigs, err := s.repo.ListFailedForReinfer(ctx, userID)
	if err != nil {
		return 0, err
	}
	n := 0
	for _, sig := range sigs {
		if err := s.repo.EnqueueReinferOutbox(ctx, sig); err != nil {
			return n, fmt.Errorf("enqueue reinfer %s: %w", sig.ID, err)
		}
		n++
	}
	return n, nil
}

// ───── handlers ─────

// adminReinfer POST /v1/admin/signals/:id/reinfer — 运营按需重推单条 (跨用户).
// 不存在 → 404; 已 done → 409; 否则 202 + {signal_id, inference_status}.
func (h *Handler) adminReinfer(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	sig, err := h.svc.AdminReinfer(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if errors.Is(err, ErrInferenceDone) {
			c.JSON(http.StatusConflict, gin.H{"error": "inference already done"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"signal_id":        sig.ID.String(),
		"inference_status": string(sig.InferenceStatus),
	})
}

// adminReinferFailed POST /v1/admin/signals/reinfer — 批量重推全部 failed.
// body 可选 {user_id}: 给定则只重推该用户的失败信号 (尊重前端"聚焦用户"). 空 body 全量.
func (h *Handler) adminReinferFailed(c *gin.Context) {
	var body struct {
		UserID string `json:"user_id"`
	}
	_ = c.ShouldBindJSON(&body) // body 可选; 空 / 非 JSON 都当全量
	var userID *uuid.UUID
	if body.UserID != "" {
		uid, err := uuid.Parse(body.UserID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		userID = &uid
	}
	n, err := h.svc.AdminReinferFailed(c.Request.Context(), userID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"reinfered": n})
}
