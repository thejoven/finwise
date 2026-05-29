package project

import (
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"flashfi/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, _ *gin.RouterGroup) {
	g := publicV1.Group("/projects")
	g.GET("", h.list)
	g.POST("", h.create)
	g.PATCH("/:id", h.update)
	g.DELETE("/:id", h.archive)
}

// ───── DTOs ─────

type projectView struct {
	ID         string    `json:"id"`
	Name       string    `json:"name"`
	Color      *string   `json:"color,omitempty"`
	Emoji      *string   `json:"emoji,omitempty"`
	SortOrder  int       `json:"sort_order"`
	ArchivedAt *string   `json:"archived_at,omitempty"`
	CreatedAt  time.Time `json:"created_at"`
}

type listResponse struct {
	Projects []projectView `json:"projects"`
}

type createRequest struct {
	Name      string  `json:"name"`
	Color     *string `json:"color,omitempty"`
	Emoji     *string `json:"emoji,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
}

type updateRequest struct {
	Name      *string `json:"name,omitempty"`
	Color     *string `json:"color,omitempty"`
	Emoji     *string `json:"emoji,omitempty"`
	SortOrder *int    `json:"sort_order,omitempty"`
}

// ───── Handlers ─────

func (h *Handler) list(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	rows, err := h.svc.ListActive(c.Request.Context(), userID)
	if err != nil {
		writeErr(c, err)
		return
	}
	views := make([]projectView, len(rows))
	for i, p := range rows {
		views[i] = toView(p)
	}
	c.JSON(http.StatusOK, listResponse{Projects: views})
}

func (h *Handler) create(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	sort := 0
	if req.SortOrder != nil {
		sort = *req.SortOrder
	}
	p, err := h.svc.Create(c.Request.Context(), CreateCommand{
		UserID:    userID,
		Name:      req.Name,
		Color:     req.Color,
		Emoji:     req.Emoji,
		SortOrder: sort,
	})
	if err != nil {
		if errors.Is(err, ErrDuplicateName) {
			c.JSON(http.StatusConflict, gin.H{"error": "name already used"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusCreated, toView(*p))
}

func (h *Handler) update(c *gin.Context) {
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
	var req updateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	p, err := h.svc.Update(c.Request.Context(), UpdateCommand{
		UserID:    userID,
		ID:        id,
		Name:      req.Name,
		Color:     req.Color,
		Emoji:     req.Emoji,
		SortOrder: req.SortOrder,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if errors.Is(err, ErrDuplicateName) {
			c.JSON(http.StatusConflict, gin.H{"error": "name already used"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toView(*p))
}

func (h *Handler) archive(c *gin.Context) {
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
	if err := h.svc.Archive(c.Request.Context(), userID, id); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "archived"})
}

// ───── helpers ─────

func toView(p Project) projectView {
	v := projectView{
		ID:        p.ID.String(),
		Name:      p.Name,
		Color:     p.Color,
		Emoji:     p.Emoji,
		SortOrder: p.SortOrder,
		CreatedAt: p.CreatedAt,
	}
	if p.ArchivedAt != nil {
		s := p.ArchivedAt.UTC().Format(time.RFC3339)
		v.ArchivedAt = &s
	}
	return v
}

func writeErr(c *gin.Context, err error) {
	if errors.Is(err, ErrInvalidInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.Error(err) //nolint:errcheck
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
}
