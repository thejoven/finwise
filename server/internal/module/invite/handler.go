package invite

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

// Register 把邀请码管理路由挂到 adminV1 (/v1/admin). 全部走 Bearer + RequireAdmin,
// 所以"仅管理员可创建/查看/吊销邀请码"由路由组保证, handler 不再单独判 is_admin.
//
//	POST   /v1/admin/invites            新建邀请码
//	GET    /v1/admin/invites            列出全部邀请码
//	POST   /v1/admin/invites/:id/revoke 吊销
func (h *Handler) Register(adminV1 *gin.RouterGroup) {
	g := adminV1.Group("/invites")
	g.POST("", h.create)
	g.GET("", h.list)
	g.POST("/:id/revoke", h.revoke)
}

// ────── DTOs ──────

type createRequest struct {
	Label         *string `json:"label"`
	MaxUses       *int    `json:"max_uses"`        // 省略/ null = 不限次
	ExpiresInDays *int    `json:"expires_in_days"` // 省略/ null = 永不过期
}

type inviteView struct {
	ID        string     `json:"id"`
	Code      string     `json:"code"`
	Label     *string    `json:"label,omitempty"`
	MaxUses   *int       `json:"max_uses,omitempty"`
	Uses      int        `json:"uses"`
	Status    string     `json:"status"` // active | exhausted | expired | revoked
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	RevokedAt *time.Time `json:"revoked_at,omitempty"`
	CreatedBy *string    `json:"created_by,omitempty"`
	CreatedAt time.Time  `json:"created_at"`
}

func toInviteView(ic *InviteCode) inviteView {
	v := inviteView{
		ID:        ic.ID.String(),
		Code:      ic.Code,
		Label:     ic.Label,
		MaxUses:   ic.MaxUses,
		Uses:      ic.Uses,
		Status:    ic.Status(time.Now()),
		ExpiresAt: ic.ExpiresAt,
		RevokedAt: ic.RevokedAt,
		CreatedAt: ic.CreatedAt,
	}
	if ic.CreatedBy != nil {
		s := ic.CreatedBy.String()
		v.CreatedBy = &s
	}
	return v
}

// ────── handlers ──────

func (h *Handler) create(c *gin.Context) {
	var req createRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		// body 完全可省 (全默认), 但给了非法 JSON 还是报错.
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	var createdBy *uuid.UUID
	if uid, ok := auth.UserID(c); ok && uid != uuid.Nil {
		createdBy = &uid
	}
	ic, err := h.svc.Create(c.Request.Context(), CreateCommand{
		Label:         req.Label,
		MaxUses:       req.MaxUses,
		ExpiresInDays: req.ExpiresInDays,
		CreatedBy:     createdBy,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, toInviteView(ic))
}

func (h *Handler) list(c *gin.Context) {
	codes, err := h.svc.List(c.Request.Context())
	if err != nil {
		writeServiceError(c, err)
		return
	}
	out := make([]inviteView, 0, len(codes))
	for i := range codes {
		out = append(out, toInviteView(&codes[i]))
	}
	c.JSON(http.StatusOK, gin.H{"invites": out, "total": len(out)})
}

func (h *Handler) revoke(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad invite id"})
		return
	}
	ic, err := h.svc.Revoke(c.Request.Context(), id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, toInviteView(ic))
}

func writeServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "invite code not found"})
	default:
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	}
}
