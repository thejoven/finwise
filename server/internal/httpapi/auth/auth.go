// Package auth holds the HTTP authentication middleware.
//
// 两种入口:
//
//  1. Bearer — accept either:
//     (a) DEV_BEARER_TOKEN (单用户 fallback, 用于 mastra/web-admin/curl, 落到 DEV_USER_ID), 或
//     (b) sessions 表里的 token (注册/登录后客户端拿到的 opaque random token), 落到 sessions.user_id.
//     先匹配 dev token, 不中再走 SessionLookup. 这样旧调用方零改动, 新用户走多用户路径.
//
//  2. InternalSecret — X-Internal-Token, 给 Mastra worker 用. 可选 loopback-only.
package auth

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

const (
	contextKeyUserID = "auth.user_id"
	bearerPrefix     = "Bearer "

	HeaderInternalToken = "X-Internal-Token"
)

// SessionLookup 是中间件查 session → user_id 的依赖. account.Service 实现.
// 解耦的目的: auth 包不引 account/db, 测试可以 mock.
type SessionLookup interface {
	LookupSession(ctx context.Context, token string) (uuid.UUID, error)
}

// ErrSessionNotFound 是 SessionLookup 实现需要返回的"token 无效/已过期"信号.
// 中间件按这个 sentinel 判断是 401 还是 500. account.ErrSessionNotFound 用同名 var,
// 不直接 errors.Is — 调用方按字符串匹配避免循环引用.
//
// 实践: account.ErrSessionNotFound 的 .Error() 必须 == "session not found".

// BearerConfig configures the Bearer middleware.
type BearerConfig struct {
	// DevBearerToken: 兼容老 dev bearer. 任何值匹配它都落到 DevUserID. 留空禁用此路径.
	DevBearerToken string
	DevUserID      uuid.UUID

	// Sessions: 多用户 session lookup. 留 nil 禁用此路径 (auth 系统未初始化时).
	Sessions SessionLookup
}

// Bearer 是统一 Bearer 中间件 — 取代旧的 DevBearer.
// 选第一个匹配:
//  1. 如果 DevBearerToken 非空且相等, 设 DevUserID, 放行.
//  2. 否则若 Sessions != nil, 尝试 SessionLookup; 命中就设那个 user_id.
//  3. 都不中, 401.
func Bearer(cfg BearerConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		raw := c.GetHeader("Authorization")
		if !strings.HasPrefix(raw, bearerPrefix) {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "missing bearer"})
			return
		}
		token := strings.TrimPrefix(raw, bearerPrefix)
		if token == "" {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "empty bearer"})
			return
		}

		// (1) dev token 兼容路径.
		if cfg.DevBearerToken != "" && token == cfg.DevBearerToken {
			c.Set(contextKeyUserID, cfg.DevUserID)
			c.Next()
			return
		}

		// (2) sessions 路径.
		if cfg.Sessions != nil {
			uid, err := cfg.Sessions.LookupSession(c.Request.Context(), token)
			if err == nil && uid != uuid.Nil {
				c.Set(contextKeyUserID, uid)
				c.Next()
				return
			}
			// 区分"找不到/过期"和"DB 故障". 找不到 → 401, 其他 → 500.
			if err != nil && !isSessionMiss(err) {
				c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "session lookup failed"})
				return
			}
		}

		c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "bad token"})
	}
}

// isSessionMiss 用字符串匹配避免循环引用 (auth 包不引 account).
// account.ErrSessionNotFound.Error() 约定返回 "session not found".
func isSessionMiss(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, errSessionNotFound) {
		return true
	}
	return err.Error() == "session not found"
}

// errSessionNotFound 是 auth 包内部的占位, 让 account.Service.LookupSession 可以 wrap 它.
// 如果未来要拆包, 这是契约.
var errSessionNotFound = errors.New("session not found")

// AdminLookup 是 RequireAdmin 查 user → is_admin 的依赖. account.Service 实现.
// 解耦目的同 SessionLookup: auth 包不引 account.
type AdminLookup interface {
	IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error)
}

// RequireAdmin 必须挂在 Bearer 之后 (依赖 Bearer 已写入 contextKeyUserID).
// 读 UserID, 查 is_admin, 非管理员 → 403.
//
// DevUserID 直接视为管理员 (不查库) — dev token 落到 DevUserID, web-admin/mastra/curl
// 现状都靠它, 这样既保后门又不依赖 dev 占位行的 is_admin 状态.
func RequireAdmin(lookup AdminLookup, devUserID uuid.UUID) gin.HandlerFunc {
	return func(c *gin.Context) {
		uid, ok := UserID(c)
		if !ok {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "unauthenticated"})
			return
		}
		// dev token 后门: 直接放行, 不查库.
		if devUserID != uuid.Nil && uid == devUserID {
			c.Next()
			return
		}
		if lookup == nil {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin required"})
			return
		}
		isAdmin, err := lookup.IsAdmin(c.Request.Context(), uid)
		if err != nil {
			c.AbortWithStatusJSON(http.StatusInternalServerError, gin.H{"error": "admin check failed"})
			return
		}
		if !isAdmin {
			c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "admin required"})
			return
		}
		c.Next()
	}
}

// InternalSecretConfig configures the internal-only auth middleware.
type InternalSecretConfig struct {
	Token        string // required; clients send "X-Internal-Token: <Token>"
	LoopbackOnly bool   // if true, reject non-loopback remote addrs
}

func InternalSecret(cfg InternalSecretConfig) gin.HandlerFunc {
	return func(c *gin.Context) {
		if cfg.LoopbackOnly {
			if !isLoopback(c.Request.RemoteAddr) {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "internal route is loopback-only"})
				return
			}
		}
		got := c.GetHeader(HeaderInternalToken)
		if got == "" || got != cfg.Token {
			c.AbortWithStatusJSON(http.StatusUnauthorized, gin.H{"error": "bad internal token"})
			return
		}
		c.Next()
	}
}

// UserID retrieves the authenticated user from the request context.
// Returns (zero, false) if no user is attached — handler should 401.
func UserID(c *gin.Context) (uuid.UUID, bool) {
	v, ok := c.Get(contextKeyUserID)
	if !ok {
		return uuid.Nil, false
	}
	id, ok := v.(uuid.UUID)
	return id, ok
}

func isLoopback(remoteAddr string) bool {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	if host == "" {
		return false
	}
	ip := net.ParseIP(host)
	if ip == nil {
		return false
	}
	return ip.IsLoopback()
}
