package account

import (
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"alphax/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
	// signer 给头像私有读代理签发/校验短期 URL. nil = 未装配 (DTO 不带 avatar_url). 经 SetAvatarSigner 注入.
	signer *AvatarSigner
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// SetAvatarSigner 注入头像 URL 签名器 (装配期调用; 不改构造签名以免破坏 cmd/admin).
func (h *Handler) SetAvatarSigner(signer *AvatarSigner) {
	h.signer = signer
}

// Register 把 account 路由挂到 router. 注意 register/login 是 unauth 的, 不能
// 走 publicV1 (那个 group 强制 Bearer). 调用方传 anon group 进来.
//
//	anon       : /v1/auth/register, /v1/auth/login                (无需 Bearer)
//	publicV1   : /v1/me, /v1/me/password, /v1/auth/logout         (需 Bearer)
//	internalV1 : 暂未使用
//	adminV1    : /v1/admin/users, /v1/admin/users/:id            (需 Bearer + RequireAdmin)
func (h *Handler) Register(anon, publicV1, internalV1, adminV1 *gin.RouterGroup) {
	authGrp := anon.Group("/auth")
	authGrp.POST("/register", h.register)
	authGrp.POST("/login", h.login)

	publicV1.POST("/auth/logout", h.logout)

	me := publicV1.Group("/me")
	me.GET("", h.getMe)
	me.PATCH("", h.updateMe)
	me.POST("/password", h.changePassword)
	me.GET("/stats", h.getMyStats)
	// 头像: 预签名直传 → confirm 校验 → 移除. 私有读代理 (/v1/avatars/:id) 挂 anon (签名自证, 见下).
	me.POST("/avatar/upload-url", h.avatarUploadURL)
	me.POST("/avatar/confirm", h.avatarConfirm)
	me.DELETE("/avatar", h.avatarRemove)

	// /v1/avatars/:id — 头像私有读代理. 不走 Bearer (SwiftUI Image / <img> 无法带头),
	// 靠 HMAC 签名 (?exp=&sig=) 自证. 只有后端现签的 URL 能命中.
	anon.GET("/avatars/:id", h.getAvatar)

	users := adminV1.Group("/users")
	users.GET("", h.adminListUsers)
	users.GET("/:id", h.adminGetUser)
	users.POST("/:id/admin", h.adminSetAdmin) // body: {is_admin: bool} — 授予/收回管理员
}

// ────── DTOs ──────

type registerRequest struct {
	Email       string  `json:"email"`
	Password    string  `json:"password"`
	DisplayName *string `json:"display_name"`
	InviteCode  string  `json:"invite_code"`
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type updateMeRequest struct {
	DisplayName *string `json:"display_name"`
	Bio         *string `json:"bio"`
	Language    *string `json:"language"`
	// avatar_url 不在此 — 头像走 /v1/me/avatar/* 上传链路, DTO 的 avatar_url 由后端现签.
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
	Language    *string   `json:"language,omitempty"`
	IsAdmin     bool      `json:"is_admin"`
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

// userView 把领域 PublicUser 转成 DTO; avatar_url 按 avatar_object_key 现签 (短期签名 URL).
func (h *Handler) userView(u *PublicUser) userView {
	v := userView{
		ID:          u.ID.String(),
		Email:       u.Email,
		DisplayName: u.DisplayName,
		Bio:         u.Bio,
		Language:    u.Language,
		IsAdmin:     u.IsAdmin,
		CreatedAt:   u.CreatedAt,
	}
	v.AvatarURL = h.signedAvatarURL(u.AvatarObjectKey, u.ID, u.UpdatedAt)
	return v
}

// signedAvatarURL 有头像键且签名器就绪时, 返回现签的相对 avatar_url; 否则 nil.
func (h *Handler) signedAvatarURL(key *string, id uuid.UUID, updatedAt time.Time) *string {
	if key == nil || *key == "" || h.signer == nil {
		return nil
	}
	s := h.signer.SignedPath(id, updatedAt.Unix())
	return &s
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
		InviteCode:  req.InviteCode,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusCreated, authResponse{User: h.userView(u), Session: toSessionView(tok)})
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
	c.JSON(http.StatusOK, authResponse{User: h.userView(u), Session: toSessionView(tok)})
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
	c.JSON(http.StatusOK, h.userView(u))
}

// getMyStats GET /v1/me/stats — 个人资料页指标汇总 + 一年活动点阵.
// Stats 结构体自带 json tag, 直接序列化.
func (h *Handler) getMyStats(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	stats, err := h.svc.GetStats(c.Request.Context(), userID)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, stats)
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
		Language:    req.Language,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, h.userView(u))
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

// ────── 头像 (avatar) handlers ──────

type avatarUploadURLResponse struct {
	UploadURL string    `json:"upload_url"`
	Method    string    `json:"method"`
	ExpiresAt time.Time `json:"expires_at"`
}

// avatarUploadURL POST /v1/me/avatar/upload-url — 发预签名 PUT URL, 客户端直传 R2.
func (h *Handler) avatarUploadURL(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	url, exp, err := h.svc.CreateAvatarUploadURL(c.Request.Context(), userID)
	if err != nil {
		writeAvatarError(c, err)
		return
	}
	c.JSON(http.StatusOK, avatarUploadURLResponse{UploadURL: url, Method: http.MethodPut, ExpiresAt: exp})
}

// avatarConfirm POST /v1/me/avatar/confirm — 校验已直传对象并落库, 返回更新后的用户 (含现签 avatar_url).
func (h *Handler) avatarConfirm(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	u, err := h.svc.ConfirmAvatar(c.Request.Context(), userID)
	if err != nil {
		writeAvatarError(c, err)
		return
	}
	c.JSON(http.StatusOK, h.userView(u))
}

// avatarRemove DELETE /v1/me/avatar — 移除头像.
func (h *Handler) avatarRemove(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	u, err := h.svc.RemoveAvatar(c.Request.Context(), userID)
	if err != nil {
		writeAvatarError(c, err)
		return
	}
	c.JSON(http.StatusOK, h.userView(u))
}

// getAvatar GET /v1/avatars/:id?exp=&sig=&v= — 头像私有读代理. 不走 Bearer, 靠 HMAC 签名自证.
func (h *Handler) getAvatar(c *gin.Context) {
	idStr := c.Param("id")
	id, err := uuid.Parse(idStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad user id"})
		return
	}
	exp, _ := strconv.ParseInt(c.Query("exp"), 10, 64)
	if h.signer == nil || !h.signer.Verify(idStr, exp, c.Query("sig")) {
		c.JSON(http.StatusForbidden, gin.H{"error": "bad or expired signature"})
		return
	}
	rc, ctype, size, err := h.svc.OpenAvatar(c.Request.Context(), id)
	if err != nil {
		writeAvatarError(c, err)
		return
	}
	defer rc.Close()
	if ctype == "" {
		ctype = "application/octet-stream"
	}
	c.Header("Cache-Control", "private, max-age=600")
	c.DataFromReader(http.StatusOK, size, ctype, rc, nil)
}

// writeAvatarError 把头像相关错误映射成 HTTP 状态.
func writeAvatarError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrStorageUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "对象存储未配置"})
	case errors.Is(err, ErrObjectNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "头像不存在 (上传未完成?)"})
	case errors.Is(err, ErrAvatarTooLarge):
		c.JSON(http.StatusBadRequest, gin.H{"error": "图片过大 (上限 5MB)"})
	case errors.Is(err, ErrAvatarBadType):
		c.JSON(http.StatusBadRequest, gin.H{"error": "仅支持 JPEG / PNG / WebP"})
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	default:
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	}
}

// ────── admin handlers ──────

type adminUserView struct {
	ID          string     `json:"id"`
	Email       string     `json:"email"`
	DisplayName *string    `json:"display_name,omitempty"`
	AvatarURL   *string    `json:"avatar_url,omitempty"`
	Bio         *string    `json:"bio,omitempty"`
	IsAdmin     bool       `json:"is_admin"`
	SignalCount int        `json:"signal_count"`
	LastSeenAt  *time.Time `json:"last_seen_at,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
}

func (h *Handler) adminUserView(u AdminUserView) adminUserView {
	return adminUserView{
		ID:          u.ID.String(),
		Email:       u.Email,
		DisplayName: u.DisplayName,
		AvatarURL:   h.signedAvatarURL(u.AvatarObjectKey, u.ID, u.UpdatedAt),
		Bio:         u.Bio,
		IsAdmin:     u.IsAdmin,
		SignalCount: u.SignalCount,
		LastSeenAt:  u.LastSeenAt,
		CreatedAt:   u.CreatedAt,
	}
}

// adminListUsers GET /v1/admin/users — 全部用户 + 活动指标. 仅管理员可达.
func (h *Handler) adminListUsers(c *gin.Context) {
	users, err := h.svc.ListUsers(c.Request.Context())
	if err != nil {
		writeServiceError(c, err)
		return
	}
	out := make([]adminUserView, 0, len(users))
	for _, u := range users {
		out = append(out, h.adminUserView(u))
	}
	c.JSON(http.StatusOK, gin.H{"users": out, "total": len(out)})
}

// adminGetUser GET /v1/admin/users/:id — 单用户详情. 仅管理员可达.
func (h *Handler) adminGetUser(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad user id"})
		return
	}
	u, err := h.svc.GetUser(c.Request.Context(), id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, h.userView(u))
}

type adminSetAdminRequest struct {
	IsAdmin *bool `json:"is_admin"`
}

// adminSetAdmin POST /v1/admin/users/:id/admin — 授予/收回管理员. 仅管理员可达.
// 防自锁: 不允许管理员收回自己的 admin.
func (h *Handler) adminSetAdmin(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad user id"})
		return
	}
	var req adminSetAdminRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.IsAdmin == nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "body must be {\"is_admin\": true|false}"})
		return
	}
	if caller, ok := auth.UserID(c); ok && caller == id && !*req.IsAdmin {
		c.JSON(http.StatusBadRequest, gin.H{"error": "不能收回自己的管理员权限"})
		return
	}
	target, err := h.svc.GetUser(c.Request.Context(), id)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	u, err := h.svc.SetAdmin(c.Request.Context(), target.Email, *req.IsAdmin)
	if err != nil {
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, h.userView(u))
}

func writeServiceError(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrInvalidInput):
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
	case errors.Is(err, ErrInviteRequired):
		c.JSON(http.StatusBadRequest, gin.H{"error": "请输入邀请码"})
	case errors.Is(err, ErrInviteInvalid):
		c.JSON(http.StatusForbidden, gin.H{"error": "邀请码无效或已用尽"})
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
