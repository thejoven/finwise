package gate

import (
	"context"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"alphax/server/internal/domain"
	"alphax/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, internalV1, adminV1 *gin.RouterGroup) {
	pub := publicV1.Group("/gate")
	pub.GET("/evaluations", h.listAll)
	pub.GET("/evaluations/:id", h.get)
	pub.GET("/pools/:pool", h.listPool)
	pub.GET("/by-refinement/:refinement_id", h.getByRefinement)
	// 用户从降噪页手动触发投决会 ("前置于投决会" 流程). 校验 ownership 后 detached 跑.
	pub.POST("/evaluate", h.evaluatePublic)
	// 归档页 → 与否决分析师继续对话. POST 同步等 LLM 回复 (客户端长超时 + typewriter).
	pub.GET("/evaluations/:id/chat", h.listChat)
	pub.POST("/evaluations/:id/chat", h.postChat)

	// 这个 endpoint 给运维 / 调试用 — 直接触发 Evaluate (不校验 ownership), 不走业务流.
	internalV1.POST("/gate/evaluate", h.evaluate)

	// 运营后台跨用户评估列表 (RequireAdmin).
	adminV1.GET("/gate/evaluations", h.adminList)
}

type evaluationResponse struct {
	ID           string              `json:"id"`
	RefinementID string              `json:"refinement_id"`
	Gates        domain.GateDetail   `json:"gates"`
	Passed       bool                `json:"passed"`
	FailedGate   *int                `json:"failed_gate,omitempty"`
	ArchivedPool *domain.ArchivePool `json:"archived_pool,omitempty"`
	EvaluatedAt  string              `json:"evaluated_at"`
	// Signal — 评估对应的信号上下文 (读取路径 JOIN 取得). 归档卡片 / 对话页展示用.
	Signal *signalContextResponse `json:"signal,omitempty"`
}

type signalContextResponse struct {
	ID      string  `json:"id"`
	Asset   *string `json:"asset,omitempty"`
	Summary string  `json:"summary,omitempty"`
}

type chatMessageResponse struct {
	ID        string `json:"id"`
	Role      string `json:"role"`
	Content   string `json:"content"`
	CreatedAt string `json:"created_at"`
}

func toChatMessageResponse(m ChatMessage) chatMessageResponse {
	return chatMessageResponse{
		ID:        m.ID.String(),
		Role:      m.Role,
		Content:   m.Content,
		CreatedAt: m.CreatedAt.UTC().Format("2006-01-02T15:04:05.000Z07:00"),
	}
}

type evaluateRequest struct {
	RefinementID string `json:"refinement_id"`
}

func (h *Handler) get(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	ev, err := h.svc.repo.GetByID(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, toEvaluationResponse(ev))
}

func (h *Handler) getByRefinement(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	refID, err := uuid.Parse(c.Param("refinement_id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refinement_id not a uuid"})
		return
	}
	ev, err := h.svc.repo.GetByRefinementID(c.Request.Context(), userID, refID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, toEvaluationResponse(ev))
}

// listAll GET /v1/gate/evaluations — 用户全部评估 (新→旧, 含 passed). web-admin 列表用.
func (h *Handler) listAll(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	limit := 100
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	items, err := h.svc.repo.ListAll(c.Request.Context(), userID, limit)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]evaluationResponse, len(items))
	for i, ev := range items {
		out[i] = toEvaluationResponse(&ev)
	}
	c.JSON(http.StatusOK, gin.H{"evaluations": out})
}

func (h *Handler) listPool(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	poolStr := c.Param("pool")
	switch domain.ArchivePool(poolStr) {
	case domain.PoolObservation, domain.PoolLesson, domain.PoolCalendar, domain.PoolDiscard:
		// ok
	default:
		c.JSON(http.StatusBadRequest, gin.H{"error": "unknown pool"})
		return
	}
	limit := 50
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil && n > 0 {
			limit = n
		}
	}
	var projectID *uuid.UUID
	if s := c.Query("project_id"); s != "" {
		pid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project_id not a uuid"})
			return
		}
		projectID = &pid
	}
	items, err := h.svc.repo.ListByPool(c.Request.Context(), userID, domain.ArchivePool(poolStr), limit, projectID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]evaluationResponse, len(items))
	for i, ev := range items {
		out[i] = toEvaluationResponse(&ev)
	}
	c.JSON(http.StatusOK, gin.H{"evaluations": out})
}

func (h *Handler) evaluate(c *gin.Context) {
	var req evaluateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	id, err := uuid.Parse(req.RefinementID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refinement_id not a uuid"})
		return
	}
	ev, err := h.svc.Evaluate(c.Request.Context(), id)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, toEvaluationResponse(ev))
}

// evaluatePublic — 用户从降噪页点"上投决会"时调. 校验 refinement 属于本人后,
// detached 跑评估 (含 4 次 LLM, 不让客户端干等), 立即 202. 评估结果之后照常
// 通过 gate.passed → 承诺书草稿 → inbox callout 浮现.
func (h *Handler) evaluatePublic(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req evaluateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	refID, err := uuid.Parse(req.RefinementID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refinement_id not a uuid"})
		return
	}
	owns, err := h.svc.OwnsRefinement(c.Request.Context(), userID, refID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	if !owns {
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		return
	}
	h.svc.EvaluateDetached(refID)
	c.JSON(http.StatusAccepted, gin.H{"status": "evaluating"})
}

func toEvaluationResponse(ev *Evaluation) evaluationResponse {
	out := evaluationResponse{
		ID:           ev.ID.String(),
		RefinementID: ev.RefinementID.String(),
		Gates:        ev.Gates,
		Passed:       ev.Passed,
		FailedGate:   ev.FailedGate,
		ArchivedPool: ev.ArchivedPool,
		EvaluatedAt:  ev.EvaluatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if ev.Signal != nil {
		out.Signal = &signalContextResponse{
			ID:      ev.Signal.ID.String(),
			Asset:   ev.Signal.Asset,
			Summary: ev.Signal.Summary,
		}
	}
	return out
}

// ───── 分析师对话 ─────

// listChat GET /v1/gate/evaluations/:id/chat — 该评估下的全部对话 (升序).
func (h *Handler) listChat(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	msgs, err := h.svc.ListChat(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]chatMessageResponse, len(msgs))
	for i, m := range msgs {
		out[i] = toChatMessageResponse(m)
	}
	c.JSON(http.StatusOK, gin.H{"messages": out})
}

type postChatRequest struct {
	Content string `json:"content"`
}

// postChat POST /v1/gate/evaluations/:id/chat — 发一条消息, 同步等分析师回复.
// 成功返回这次新增的 [用户消息, 分析师回复] 两条; LLM 失败时不落任何消息 (503),
// 客户端保留输入原样重试.
func (h *Handler) postChat(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	var req postChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	content := strings.TrimSpace(req.Content)
	if content == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content empty"})
		return
	}
	if len([]rune(content)) > 1000 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "content too long (>1000)"})
		return
	}

	// LLM 同步往返预算 80s (mastra client 内部 75s), 不受上游默认 ctx 影响.
	ctx, cancel := context.WithTimeout(c.Request.Context(), 80*time.Second)
	defer cancel()
	msgs, err := h.svc.Chat(ctx, userID, id, content)
	if err != nil {
		switch {
		case errors.Is(err, ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
		case errors.Is(err, ErrChatNotArchived):
			c.JSON(http.StatusConflict, gin.H{"error": "evaluation passed; nothing to discuss"})
		case errors.Is(err, ErrChatUnavailable):
			c.JSON(http.StatusServiceUnavailable, gin.H{"error": "analyst unavailable, retry later"})
		default:
			c.Error(err) //nolint:errcheck
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		}
		return
	}
	out := make([]chatMessageResponse, len(msgs))
	for i, m := range msgs {
		out[i] = toChatMessageResponse(m)
	}
	c.JSON(http.StatusOK, gin.H{"messages": out})
}
