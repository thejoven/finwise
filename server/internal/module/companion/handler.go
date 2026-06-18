package companion

import (
	"errors"
	"net/http"
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

func (h *Handler) Register(publicV1, _ *gin.RouterGroup) {
	g := publicV1.Group("/commitments/:id")
	g.POST("/open", h.open)
	g.GET("/companion", h.getCompanion)
}

type openRequest struct {
	ClientEventID string  `json:"client_event_id"`
	Origin        string  `json:"origin,omitempty"`
	OpenedAt      *string `json:"opened_at,omitempty"`
}

type openResponse struct {
	OpensToday          int                 `json:"opens_today"`
	Classified          string              `json:"classified"`
	ShouldShowCompanion bool                `json:"should_show_companion"`
	Companion           *companionResponse  `json:"companion,omitempty"`
}

type companionResponse struct {
	CommitmentID string                 `json:"commitment_id"`
	Reason       domain.CompanionReason `json:"reason"`
	EditorText   string                 `json:"editor_text"`
	EditorModel  string                 `json:"editor_model"`
	ShownAt      string                 `json:"shown_at"`
}

func (h *Handler) open(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	commitID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	var req openRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	cid, err := uuid.Parse(req.ClientEventID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_event_id not a uuid"})
		return
	}
	var openedAt time.Time
	if req.OpenedAt != nil {
		t, err := time.Parse(time.RFC3339, *req.OpenedAt)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "opened_at not RFC3339"})
			return
		}
		openedAt = t
	}

	result, err := h.svc.RecordOpen(c.Request.Context(), OpenCommand{
		UserID:        userID,
		CommitmentID:  commitID,
		ClientEventID: cid,
		Origin:        domain.CommitmentOpenOrigin(req.Origin),
		OpenedAt:      openedAt,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "commitment not found or not signed"})
			return
		}
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}

	resp := openResponse{
		OpensToday:          result.OpensToday,
		Classified:          result.Classified,
		ShouldShowCompanion: result.ShouldShowCompanion,
	}
	if result.CompanionView != nil {
		resp.Companion = &companionResponse{
			CommitmentID: result.CompanionView.CommitmentID.String(),
			Reason:       result.CompanionView.Reason,
			EditorText:   result.CompanionView.EditorText,
			EditorModel:  result.CompanionView.EditorModel,
			ShownAt:      result.CompanionView.ShownAt.UTC().Format(time.RFC3339),
		}
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) getCompanion(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	commitID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	view, err := h.svc.GetCompanionToday(c.Request.Context(), userID, commitID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	if view == nil {
		c.JSON(http.StatusNoContent, nil)
		return
	}
	c.JSON(http.StatusOK, companionResponse{
		CommitmentID: view.CommitmentID.String(),
		Reason:       view.Reason,
		EditorText:   view.EditorText,
		EditorModel:  view.EditorModel,
		ShownAt:      view.ShownAt.UTC().Format(time.RFC3339),
	})
}
