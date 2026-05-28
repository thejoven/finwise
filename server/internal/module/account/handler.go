package account

import (
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"flashfi/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register 把 account 路由挂到 router. 注意 register/login 是 unauth 的, 不能
// 走 publicV1 (那个 group 强制 Bearer). 调用方传 anon group 进来.
//
//   anon       : /v1/auth/register, /v1/auth/login           (无需 Bearer)
//   publicV1   : /v1/me, /v1/me/password, /v1/auth/logout    (需 Bearer)
//   internalV1 : 暂未使用
func (h *Handler) Register(anon, publicV1, internalV1 *gin.RouterGroup) {
	authGrp := anon.Group("/auth")
	authGrp.POST("/register", h.register)
	authGrp.POST("/login", h.login)

	publicV1.POST("/auth/logout", h.logout)

	me := publicV1.Group("/me")
	me.GET("", h.getMe)
	me.PATCH("", h.updateMe)
	me.POST("/password", h.changePassword)
}

// ────── DTOs ──────

type registerRequest struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"display_name"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type updateMeRequest struct {
	DisplayName *string `json:"display_name"`
	Bio         *string `json:"bio"`
	AvatarURL   *string `json:"avatar_url"`
}

type changePasswordRequest struct {
	OldPassword string `json:"old_password"`
	NewPassword string `json:"new_password"`
}

type userView struct {
	ID          string    `json:"id"`
	Email       string    `json:"email"`
	DisplayName *string   `json:"display_name,omitempty"`
	AvatarURL   *string   `json:"avatar_url,omitempty"`
	Bio         *string   `json:"bio,omitempty"`
	CreatedAt   time.Time `json:"created_at"`
}

type sessionView struct {
	Token     string    `json:"token"`
	ExpiresAt time.Time `json:"expires_at"`
}

type authResponse struct {
	User    userView    `json:"user"`
	Session sessionView `json:"session"`
}

func toUserView(u *PublicUser) userView {
	return userView{
		ID:          u.ID.String(),
		Email:       u.Email,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Bio:         u.Bio,
		CreatedAt:   u.CreatedAt,
	}
}

func toSessionView(t *SessionToken) sessionView {
	return sessionView{Token: t.Token, ExpiresAt: t.ExpiresAt}
}

// ────── Handlers ──────

func (h *Handler) register(c *gin.Context) {
	var req registerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	u, tok, err := h.svc.Register(c.Request.Context(), RegisterCommand{
		Email:       req.Email,
		Password:    req.Password,
		DisplayName: req.DisplayName,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, authResponse{User: toUserView(u), Session: toSessionView(tok)})
}

func (h *Handler) login(c *gin.Context) {
	var req loginRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	u, tok, err := h.svc.Login(c.Request.Context(), LoginCommand{
		Email:    req.Email,
		Password: req.Password,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, authResponse{User: toUserView(u), Session: toSessionView(tok)})
}

func (h *Handler) logout(c *gin.Context) {
	// 取请求 Authorization 里的 token. middleware 已经验过它有效, 这里取来删.
	raw := c.GetHeader("Authorization")
	tok := strings.TrimPrefix(raw, "Bearer ")
	if err := h.svc.Logout(c.Request.Context(), tok); err != nil {
		writeServiceError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) getMe(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	u, err := h.svc.GetMe(c.Request.Context(), userID)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, toUserView(u))
}

func (h *Handler) updateMe(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req updateMeRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	u, err := h.svc.UpdateMe(c.Request.Context(), userID, UpdateMeCommand{
		DisplayName: req.DisplayName,
		Bio:         req.Bio,
		AvatarURL:   req.AvatarURL,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, toUserView(u))
}

func (h *Handler) changePassword(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req changePasswordRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	if err := h.svc.ChangePassword(c.Request.Context(), userID, req.OldPassword, req.NewPassword); err != nil {
		writeServiceError(c, err)
		return
	}
	c.Status(http.StatusNoContent)
}

func writeServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrEmailExists):
		c.JSON(http.StatusConflict, gin.H{"error": "email already registered"})
	case errors.Is(err, ErrBadCredentials):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "bad credentials"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case errors.Is(err, ErrSessionNotFound):
		c.JSON(http.StatusUnauthorized, gin.H{"error": "session invalid"})
	default:
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	}
}
