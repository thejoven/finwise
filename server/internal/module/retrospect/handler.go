package retrospect

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, _, adminV1 *gin.RouterGroup) {
	adminV1.GET("/retrospects", h.adminList)
	g := publicV1.Group("/retrospects")
	g.POST("", h.start)
	g.GET("", h.list)
	g.GET("/:id", h.get)
	g.POST("/:id/answers", h.answer)
	g.POST("/:id/finalize", h.finalize)
}

type startRequest struct {
	CommitmentID string `json:"commitment_id"`
	Trigger      string `json:"trigger,omitempty"`
}

type retrospectResponse struct {
	ID                 string        `json:"id"`
	CommitmentID       string        `json:"commitment_id"`
	State              string        `json:"state"`
	StartedAt          string        `json:"started_at"`
	FinalizedAt        *string       `json:"finalized_at,omitempty"`
	Answers            []AnswerEntry `json:"answers"`
	FocusDim           *string       `json:"focus_dim,omitempty"`
	FocusText          *string       `json:"focus_text,omitempty"`
	DiagnosticianModel *string       `json:"diagnostician_model,omitempty"`
}

type answerRequest struct {
	ClientEventID string  `json:"client_event_id"`
	QuestionNo    int     `json:"question_no"`
	Dim           string  `json:"question_dim"`
	Choice        string  `json:"choice"`
	OpenText      *string `json:"open_text,omitempty"`
}

func (h *Handler) start(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req startRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	commitID, err := uuid.Parse(req.CommitmentID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "commitment_id not a uuid"})
		return
	}
	retro, err := h.svc.Start(c.Request.Context(), userID, commitID, domain.RetrospectTrigger(req.Trigger))
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toResponse(retro))
}

func (h *Handler) list(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	limit := 20
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
	items, err := h.svc.List(c.Request.Context(), userID, limit, projectID)
	if err != nil {
		writeErr(c, err)
		return
	}
	out := make([]retrospectResponse, len(items))
	for i, r := range items {
		out[i] = toResponse(&r)
	}
	c.JSON(http.StatusOK, gin.H{"retrospects": out})
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
	retro, err := h.svc.Get(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toResponse(retro))
}

func (h *Handler) answer(c *gin.Context) {
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
	var req answerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	cid, err := uuid.Parse(req.ClientEventID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_event_id not a uuid"})
		return
	}
	retro, err := h.svc.Answer(c.Request.Context(), AnswerCommand{
		UserID:        userID,
		RetrospectID:  id,
		ClientEventID: cid,
		QuestionNo:    req.QuestionNo,
		Dim:           domain.RetrospectDimension(req.Dim),
		Choice:        req.Choice,
		OpenText:      req.OpenText,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toResponse(retro))
}

func (h *Handler) finalize(c *gin.Context) {
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
	retro, err := h.svc.Finalize(c.Request.Context(), userID, id)
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toResponse(retro))
}

func toResponse(r *Retrospect) retrospectResponse {
	out := retrospectResponse{
		ID:                 r.ID.String(),
		CommitmentID:       r.CommitmentID.String(),
		State:              r.State,
		StartedAt:          r.StartedAt.Format("2006-01-02T15:04:05Z07:00"),
		Answers:            r.Answers,
		FocusDim:           r.FocusDim,
		FocusText:          r.FocusText,
		DiagnosticianModel: r.DiagnosticianModel,
	}
	if r.FinalizedAt != nil {
		s := r.FinalizedAt.Format("2006-01-02T15:04:05Z07:00")
		out.FinalizedAt = &s
	}
	return out
}

func writeErr(c *gin.Context, err error) {
	if errors.Is(err, ErrInvalidInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrAlreadyFinalized) || errors.Is(err, ErrInvalidState) {
		c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
		return
	}
	c.Error(err) //nolint:errcheck
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal: " + err.Error()})
}
