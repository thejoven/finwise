package project

import (
	"testing"

	"github.com/gin-gonic/gin"
)

// TestRegisterNoRouteConflict 确认新增的 GET /archived 与 POST /:id/restore 不和现有
// /:id 路由在 gin 里冲突 —— 同一 method 下静态段与 wildcard 段同位置会 panic.
// Register 只注册路由、不调用 handler, 故传 nil svc 安全; 跑到这里不 panic 即通过.
func TestRegisterNoRouteConflict(t *testing.T) {
	gin.SetMode(gin.TestMode)
	r := gin.New()
	g := r.Group("/v1")
	// adminV1 must be a SEPARATE group (prod: /v1 vs /v1/admin); passing the same
	// /v1 group would make admin GET /projects collide with the public list route.
	admin := r.Group("/v1/admin")
	NewHandler(nil).Register(g, g, admin)
}
