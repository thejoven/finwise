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
	NewHandler(nil).Register(g, g, g)
}
