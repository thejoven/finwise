package commitment

import (
	"encoding/json"
	"errors"
	"net/http"

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
	pub := publicV1.Group("/commitments")
	pub.GET("/active", h.active)
	pub.GET("/:id", h.get)
	pub.POST("/:id/sign", h.sign)
	pub.POST("/:id/postpone", h.postpone)

	holdings := publicV1.Group("/holdings")
	holdings.GET("/active", h.activeHolding)
	holdings.GET("/:id", h.getHolding)

	internalV1.POST("/commitments/draft", h.internalDraft)
}

// ───── DTOs ─────

type commitmentResponse struct {
	ID            string         `json:"id"`
	EvaluationID  string         `json:"evaluation_id"`
	Status        string         `json:"status"`
	Thesis        domain.Thesis  `json:"thesis"`
	PDFPath       *string        `json:"pdf_path,omitempty"`
	PostponeCount int            `json:"postpone_count"`
	SignedAt      *string        `json:"signed_at,omitempty"`
	DraftedAt     string         `json:"drafted_at"`
}

type holdingResponse struct {
	ID             string          `json:"id"`
	Status         string          `json:"status"`
	SignedAt       string          `json:"signed_at"`
	ExitConditions []string        `json:"exit_conditions"`
	ExpiresAt      string          `json:"expires_at"`
	ExitCheckState json.RawMessage `json:"exit_check_state"`
	TriggeredAt    *string         `json:"triggered_at,omitempty"`
	ClosedAt       *string         `json:"closed_at,omitempty"`
	ArchivedAt     *string         `json:"archived_at,omitempty"`
}

type signRequest struct {
	SigningClientID string `json:"signing_client_id"`
}

type postponeRequest struct {
	ClientEventID string  `json:"client_event_id"`
	Reason        *string `json:"reason,omitempty"`
}

type internalDraftRequest struct {
	UserID       string        `json:"user_id"`
	EvaluationID string        `json:"evaluation_id"`
	Thesis       domain.Thesis `json:"thesis"`
	Model        string        `json:"model"`
}

// ───── Handlers ─────

func (h *Handler) active(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	commit, err := h.svc.LoadActive(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	if commit == nil {
		c.JSON(http.StatusNoContent, nil)
		return
	}
	c.JSON(http.StatusOK, toCommitmentResponse(commit))
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
	commit, err := h.svc.Get(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toCommitmentResponse(commit))
}

func (h *Handler) sign(c *gin.Context) {
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
	var req signRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	commit, holding, err := h.svc.Sign(c.Request.Context(), SignCommand{
		UserID:          userID,
		CommitmentID:    id,
		SigningClientID: req.SigningClientID,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if errors.Is(err, ErrAbandoned) {
			c.JSON(http.StatusConflict, gin.H{"error": "commitment abandoned"})
			return
		}
		writeErr(c, err)
		return
	}
	resp := gin.H{"commitment": toCommitmentResponse(commit)}
	if holding != nil {
		hr := toHoldingResponse(holding)
		resp["holding"] = hr
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) postpone(c *gin.Context) {
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
	var req postponeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	cid, err := uuid.Parse(req.ClientEventID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_event_id not a uuid"})
		return
	}
	commit, err := h.svc.Postpone(c.Request.Context(), PostponeCommand{
		UserID:        userID,
		CommitmentID:  id,
		ClientEventID: cid,
		Reason:        req.Reason,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if errors.Is(err, ErrAlreadySigned) {
			c.JSON(http.StatusConflict, gin.H{"error": "already signed"})
			return
		}
		if errors.Is(err, ErrAbandoned) {
			c.JSON(http.StatusConflict, gin.H{"error": "already abandoned"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toCommitmentResponse(commit))
}

func (h *Handler) activeHolding(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	holding, err := h.svc.LoadActiveHolding(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	if holding == nil {
		c.JSON(http.StatusNoContent, nil)
		return
	}
	c.JSON(http.StatusOK, toHoldingResponse(holding))
}

func (h *Handler) getHolding(c *gin.Context) {
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
	holding, err := h.svc.GetHolding(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toHoldingResponse(holding))
}

func (h *Handler) internalDraft(c *gin.Context) {
	var req internalDraftRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}
	evalID, err := uuid.Parse(req.EvaluationID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "evaluation_id not a uuid"})
		return
	}
	commit, err := h.svc.RecordDraft(c.Request.Context(), DraftCommand{
		UserID:       userID,
		EvaluationID: evalID,
		Thesis:       req.Thesis,
		Model:        req.Model,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toCommitmentResponse(commit))
}

// ───── helpers ─────

func toCommitmentResponse(c *Commitment) commitmentResponse {
	out := commitmentResponse{
		ID:            c.ID.String(),
		EvaluationID:  c.EvaluationID.String(),
		Status:        c.Status,
		Thesis:        c.Thesis,
		PDFPath:       c.PDFPath,
		PostponeCount: c.PostponeCount,
		DraftedAt:     c.DraftedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
	}
	if c.SignedAt != nil {
		s := c.SignedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		out.SignedAt = &s
	}
	return out
}

func toHoldingResponse(h *Holding) holdingResponse {
	out := holdingResponse{
		ID:             h.ID.String(),
		Status:         h.Status,
		SignedAt:       h.SignedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		ExitConditions: h.ExitConditions,
		ExpiresAt:      h.ExpiresAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		ExitCheckState: h.ExitCheckState,
	}
	if h.TriggeredAt != nil {
		s := h.TriggeredAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		out.TriggeredAt = &s
	}
	if h.ClosedAt != nil {
		s := h.ClosedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		out.ClosedAt = &s
	}
	if h.ArchivedAt != nil {
		s := h.ArchivedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
		out.ArchivedAt = &s
	}
	return out
}

func writeErr(c *gin.Context, err error) {
	if errors.Is(err, ErrInvalidInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Error(err) //nolint:errcheck
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal: " + err.Error()})
}
