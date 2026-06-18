package research

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"alphax/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, internalV1 *gin.RouterGroup) {
	// mobile 读: 出题前的"学习卡片"
	publicV1.GET("/refinement/sessions/:id/research", h.listBySession)
	// 兼容/扩展用: 信号详情页未来也能看
	publicV1.GET("/signals/:id/research", h.listBySignal)

	// mastra 写
	internalV1.POST("/research", h.save)
}

// ───── DTOs ─────

type saveRequest struct {
	UserID       string   `json:"user_id"`
	Scope        string   `json:"scope"`
	SignalID     *string  `json:"signal_id,omitempty"`
	RefinementID *string  `json:"refinement_id,omitempty"`
	Round        *int     `json:"round,omitempty"`
	Query        string   `json:"query"`
	Results      []Result `json:"results"`
	Model        string   `json:"model"`
}

type recordView struct {
	ID           string    `json:"id"`
	Scope        string    `json:"scope"`
	SignalID     *string   `json:"signal_id,omitempty"`
	RefinementID *string   `json:"refinement_id,omitempty"`
	Round        *int      `json:"round,omitempty"`
	Query        string    `json:"query"`
	Results      []Result  `json:"results"`
	Model        string    `json:"model"`
	CreatedAt    time.Time `json:"created_at"`
}

type listResponse struct {
	Items []recordView `json:"items"`
}

// ───── Handlers ─────

func (h *Handler) save(c *gin.Context) {
	var req saveRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}

	var signalID, refinementID *uuid.UUID
	if req.SignalID != nil {
		v, err := uuid.Parse(*req.SignalID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "signal_id not a uuid"})
			return
		}
		signalID = &v
	}
	if req.RefinementID != nil {
		v, err := uuid.Parse(*req.RefinementID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "refinement_id not a uuid"})
			return
		}
		refinementID = &v
	}

	rec, err := h.svc.Save(c.Request.Context(), SaveCommand{
		UserID:       userID,
		Scope:        Scope(req.Scope),
		SignalID:     signalID,
		RefinementID: refinementID,
		Round:        req.Round,
		Query:        req.Query,
		Results:      req.Results,
		Model:        req.Model,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, toRecordView(*rec))
}

func (h *Handler) listBySession(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}

	items, err := h.svc.ListBySession(c.Request.Context(), userID, sessionID)
	if err != nil {
		if errors.Is(err, ErrSessionNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toListResponse(items))
}

func (h *Handler) listBySignal(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	signalID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	items, err := h.svc.ListBySignal(c.Request.Context(), userID, signalID)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toListResponse(items))
}

// ───── helpers ─────

func toRecordView(rec Record) recordView {
	out := recordView{
		ID:        rec.ID.String(),
		Scope:     string(rec.Scope),
		Round:     rec.Round,
		Query:     rec.Query,
		Results:   rec.Results,
		Model:     rec.Model,
		CreatedAt: rec.CreatedAt,
	}
	if rec.SignalID != nil {
		s := rec.SignalID.String()
		out.SignalID = &s
	}
	if rec.RefinementID != nil {
		s := rec.RefinementID.String()
		out.RefinementID = &s
	}
	return out
}

func toListResponse(items []Record) listResponse {
	views := make([]recordView, len(items))
	for i, it := range items {
		views[i] = toRecordView(it)
	}
	return listResponse{Items: views}
}

func writeErr(c *gin.Context, err error) {
	if errors.Is(err, ErrInvalidInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Error(err) //nolint:errcheck // gin logs it via middleware
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
}
