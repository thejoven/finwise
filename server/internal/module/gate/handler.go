package gate

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"flashfi/server/internal/domain"
	"flashfi/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, internalV1 *gin.RouterGroup) {
	pub := publicV1.Group("/gate")
	pub.GET("/evaluations/:id", h.get)
	pub.GET("/pools/:pool", h.listPool)
	pub.GET("/by-refinement/:refinement_id", h.getByRefinement)

	// 这个 endpoint 给运维 / 调试用 — 通常是 NATS consumer 触发 Evaluate, 不走 HTTP.
	internalV1.POST("/gate/evaluate", h.evaluate)
}

type evaluationResponse struct {
	ID            string                       `json:"id"`
	RefinementID  string                       `json:"refinement_id"`
	Gates         domain.GateDetail            `json:"gates"`
	Passed        bool                         `json:"passed"`
	FailedGate    *int                         `json:"failed_gate,omitempty"`
	ArchivedPool  *domain.ArchivePool          `json:"archived_pool,omitempty"`
	EvaluatedAt   string                       `json:"evaluated_at"`
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
	items, err := h.svc.repo.ListByPool(c.Request.Context(), userID, domain.ArchivePool(poolStr), limit)
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

func toEvaluationResponse(ev *Evaluation) evaluationResponse {
	return evaluationResponse{
		ID:           ev.ID.String(),
		RefinementID: ev.RefinementID.String(),
		Gates:        ev.Gates,
		Passed:       ev.Passed,
		FailedGate:   ev.FailedGate,
		ArchivedPool: ev.ArchivedPool,
		EvaluatedAt:  ev.EvaluatedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
}
