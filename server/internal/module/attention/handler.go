package attention

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"wiseflow/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, internalV1 *gin.RouterGroup) {
	publicV1.GET("/attention/summary", h.getSummary)
	internalV1.POST("/attention", h.upsert)
}

// ───── DTOs ─────

type upsertRequest struct {
	RefinementID   string `json:"refinement_id"`
	UserID         string `json:"user_id"`
	FocusScore     int    `json:"focus_score"`
	DepthScore     int    `json:"depth_score"`
	BreadthScore   int    `json:"breadth_score"`
	ExecutionScore int    `json:"execution_score"`
	Insight        string `json:"insight"`
	Blindspot      string `json:"blindspot"`
	Model          string `json:"model"`
}

type summaryRow struct {
	RefinementID   string    `json:"refinement_id"`
	FocusScore     int       `json:"focus_score"`
	DepthScore     int       `json:"depth_score"`
	BreadthScore   int       `json:"breadth_score"`
	ExecutionScore int       `json:"execution_score"`
	Insight        string    `json:"insight"`
	Blindspot      string    `json:"blindspot"`
	CreatedAt      time.Time `json:"created_at"`
}

type tagFreqDTO struct {
	Tag   string `json:"tag"`
	Count int    `json:"count"`
}

type summaryResponse struct {
	Window                string       `json:"window"`
	TotalCompleted        int          `json:"total_completed"`
	AverageFocusScore     int          `json:"average_focus_score"`
	AverageDepthScore     int          `json:"average_depth_score"`
	AverageBreadthScore   int          `json:"average_breadth_score"`
	AverageExecutionScore int          `json:"average_execution_score"`
	LatestSummaries       []summaryRow `json:"latest_summaries"`
	TopTags               []tagFreqDTO `json:"top_tags"`
}

// ───── Handlers ─────

func (h *Handler) getSummary(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	window := c.Query("window")

	var projectID *uuid.UUID
	if s := c.Query("project_id"); s != "" {
		pid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project_id not a uuid"})
			return
		}
		projectID = &pid
	}

	view, err := h.svc.GetSummary(c.Request.Context(), userID, window, projectID)
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}

	resp := summaryResponse{
		Window:                view.Window,
		TotalCompleted:        view.TotalCompleted,
		AverageFocusScore:     view.AverageFocusScore,
		AverageDepthScore:     view.AverageDepthScore,
		AverageBreadthScore:   view.AverageBreadthScore,
		AverageExecutionScore: view.AverageExecutionScore,
		LatestSummaries:       make([]summaryRow, len(view.LatestSummaries)),
		TopTags:               make([]tagFreqDTO, len(view.TopTags)),
	}
	for i, s := range view.LatestSummaries {
		resp.LatestSummaries[i] = summaryRow{
			RefinementID:   s.RefinementID.String(),
			FocusScore:     s.FocusScore,
			DepthScore:     s.DepthScore,
			BreadthScore:   s.BreadthScore,
			ExecutionScore: s.ExecutionScore,
			Insight:        s.Insight,
			Blindspot:      s.Blindspot,
			CreatedAt:      s.CreatedAt,
		}
	}
	for i, t := range view.TopTags {
		resp.TopTags[i] = tagFreqDTO{Tag: t.Tag, Count: t.Count}
	}
	c.JSON(http.StatusOK, resp)
}

func (h *Handler) upsert(c *gin.Context) {
	var req upsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	refID, err := uuid.Parse(req.RefinementID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refinement_id not a uuid"})
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}
	_, err = h.svc.Upsert(c.Request.Context(), UpsertInput{
		RefinementID:   refID,
		UserID:         userID,
		FocusScore:     req.FocusScore,
		DepthScore:     req.DepthScore,
		BreadthScore:   req.BreadthScore,
		ExecutionScore: req.ExecutionScore,
		Insight:        req.Insight,
		Blindspot:      req.Blindspot,
		Model:          req.Model,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "recorded"})
}
