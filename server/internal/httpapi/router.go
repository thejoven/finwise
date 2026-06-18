// Package httpapi builds the HTTP router.
// Kept thin: middleware + healthz + route groups here; module routes register
// themselves via Handler.Register(publicV1, internalV1).
package httpapi

import (
	"context"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"

	"alphax/server/internal/httpapi/auth"
	"alphax/server/internal/infra/db"
	"alphax/server/internal/infra/metrics"
)

type Deps struct {
	Logger *zap.Logger
	DB     *db.Pool

	DevBearerToken   string
	DevUserID        uuid.UUID
	InternalToken    string
	InternalLoopback bool

	// Sessions: 多用户 session token lookup. 通常注入 account.Service.
	// nil 时回退到单纯 dev bearer 模式.
	Sessions auth.SessionLookup

	// AdminLookup: user → is_admin 查询, 给 /v1/admin/* 的 RequireAdmin 用.
	// 通常注入 account.Service (与 Sessions 同一实例). nil 时 admin 路由仅 DevUserID 可达.
	AdminLookup auth.AdminLookup

	// RegisterModules is the module hook. Called once with the route groups
	// after the global middleware is attached.
	//   anon       — /v1 下 unauth (register/login/healthz-like)
	//   publicV1   — /v1, 走 Bearer (dev token 或 session token)
	//   internalV1 — /v1/internal, 走 InternalSecret
	//   adminV1    — /v1/admin, 走 Bearer + RequireAdmin
	RegisterModules func(anon, publicV1, internalV1, adminV1 *gin.RouterGroup)
}

func NewRouter(d Deps) *gin.Engine {
	// gin.New (not Default) — Default registers Logger+Recovery middleware
	// that we replace with zap-backed versions.
	r := gin.New()
	// CORS goes first so preflight requests (OPTIONS) get answered before
	// auth middleware would reject them as missing Bearer.
	r.Use(corsAllowAll(), requestID(), recovery(d.Logger), accessLog(d.Logger), metricsMiddleware())

	r.GET("/healthz", healthz(d.DB))
	r.GET("/metrics", gin.WrapH(metrics.Handler()))

	// anon 是 /v1 下不需要 Bearer 的子路径 (register / login).
	// 单独 group, 不挂 auth 中间件.
	anonV1 := r.Group("/v1")

	v1 := r.Group("/v1", auth.Bearer(auth.BearerConfig{
		DevBearerToken: d.DevBearerToken,
		DevUserID:      d.DevUserID,
		Sessions:       d.Sessions,
	}))

	// /v1/internal sits under the same /v1 path tree but bypasses the dev
	// bearer; it has its own shared-secret middleware and optionally is
	// loopback-only. We create it as a separate Group on the root engine
	// (not nested under v1) so the bearer middleware doesn't double-run.
	internalV1 := r.Group("/v1/internal", auth.InternalSecret(auth.InternalSecretConfig{
		Token:        d.InternalToken,
		LoopbackOnly: d.InternalLoopback,
	}))

	// adminV1: /v1/admin/* — 走和 v1 同样的 Bearer, 再叠一层 RequireAdmin.
	// 单独 Group (不嵌在 v1 下) 避免 Bearer 中间件双跑. 只有 is_admin 用户或 DevUserID 可达.
	adminV1 := r.Group("/v1/admin",
		auth.Bearer(auth.BearerConfig{
			DevBearerToken: d.DevBearerToken,
			DevUserID:      d.DevUserID,
			Sessions:       d.Sessions,
		}),
		auth.RequireAdmin(d.AdminLookup, d.DevUserID),
	)

	if d.RegisterModules != nil {
		d.RegisterModules(anonV1, v1, internalV1, adminV1)
	}

	return r
}

func healthz(pool *db.Pool) gin.HandlerFunc {
	return func(c *gin.Context) {
		ctx, cancel := context.WithTimeout(c.Request.Context(), 2*time.Second)
		defer cancel()
		if err := pool.Ping(ctx); err != nil {
			c.JSON(503, gin.H{"db": "down", "err": err.Error()})
			return
		}
		c.JSON(200, gin.H{"status": "ok"})
	}
}

// corsAllowAll lets any browser origin call the API. Bearer auth lives in the
// Authorization header (not cookies), so credentials are not part of the CORS
// contract — we echo the request Origin when present and fall back to "*".
// Preflight OPTIONS requests short-circuit with 204 before hitting downstream
// auth / route handlers.
func corsAllowAll() gin.HandlerFunc {
	return func(c *gin.Context) {
		origin := c.GetHeader("Origin")
		if origin != "" {
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Vary", "Origin")
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Origin", "*")
		}
		c.Writer.Header().Set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
		// Reflect requested headers if the browser told us; otherwise advertise
		// the ones we actually use.
		if reqHeaders := c.GetHeader("Access-Control-Request-Headers"); reqHeaders != "" {
			c.Writer.Header().Set("Access-Control-Allow-Headers", reqHeaders)
		} else {
			c.Writer.Header().Set("Access-Control-Allow-Headers",
				"Authorization, Content-Type, X-Request-ID, X-Internal-Token, X-Idempotency-Key")
		}
		c.Writer.Header().Set("Access-Control-Expose-Headers", "X-Request-ID")
		c.Writer.Header().Set("Access-Control-Max-Age", "86400")

		if c.Request.Method == http.MethodOptions {
			c.AbortWithStatus(http.StatusNoContent)
			return
		}
		c.Next()
	}
}

const requestIDHeader = "X-Request-ID"

func requestID() gin.HandlerFunc {
	return func(c *gin.Context) {
		rid := c.GetHeader(requestIDHeader)
		if rid == "" {
			rid = uuid.NewString()
		}
		c.Set("request_id", rid)
		c.Writer.Header().Set(requestIDHeader, rid)
		c.Next()
	}
}

func recovery(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		defer func() {
			if rec := recover(); rec != nil {
				logger.Error("panic recovered",
					zap.Any("panic", rec),
					zap.String("path", c.Request.URL.Path),
					zap.String("request_id", c.GetString("request_id")),
				)
				c.AbortWithStatusJSON(500, gin.H{"error": "internal"})
			}
		}()
		c.Next()
	}
}

func accessLog(logger *zap.Logger) gin.HandlerFunc {
	return func(c *gin.Context) {
		start := time.Now()
		c.Next()
		logger.Info("http",
			zap.String("method", c.Request.Method),
			zap.String("path", c.Request.URL.Path),
			zap.Int("status", c.Writer.Status()),
			zap.Duration("dur", time.Since(start)),
			zap.String("request_id", c.GetString("request_id")),
		)
	}
}

// metricsMiddleware 记录 HTTP request counter + duration.
// 用 gin FullPath (e.g. "/v1/refinement/sessions/:id") 而非 raw URL, 防 cardinality 爆炸.
// /metrics 本身的请求不再记 (无意义的递归).
func metricsMiddleware() gin.HandlerFunc {
	return func(c *gin.Context) {
		if c.Request.URL.Path == "/metrics" {
			c.Next()
			return
		}
		start := time.Now()
		c.Next()
		route := c.FullPath()
		if route == "" {
			route = "_unknown"
		}
		method := c.Request.Method
		status := c.Writer.Status()
		metrics.HTTPRequests.WithLabelValues(method, route, metrics.StatusClass(status)).Inc()
		metrics.HTTPDuration.WithLabelValues(method, route).Observe(time.Since(start).Seconds())
	}
}
