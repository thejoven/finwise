package billing

import (
	"errors"
	"io"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"alphax/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register 挂 billing 路由.
//
//	anon : POST /v1/billing/revenuecat/webhook  (RevenueCat 调; 无 Bearer, service 内校验 Authorization)
//	v1   : GET  /v1/billing/entitlement         (需 Bearer; 客户端读自己的订阅状态)
func (h *Handler) Register(anon, v1 *gin.RouterGroup) {
	anon.POST("/billing/revenuecat/webhook", h.webhook)

	bil := v1.Group("/billing")
	bil.GET("/entitlement", h.getEntitlement)
}

type entitlementView struct {
	IsPro     bool       `json:"is_pro"`
	ProductID *string    `json:"product_id,omitempty"`
	Store     *string    `json:"store,omitempty"`
	ExpiresAt *time.Time `json:"expires_at,omitempty"`
	WillRenew bool       `json:"will_renew"`
}

// getEntitlement GET /v1/billing/entitlement — 当前用户的订阅状态. 公网后端就绪后,
// 客户端 billing store 以这个端点为权威真相 (内网阶段先信 RevenueCat SDK).
func (h *Handler) getEntitlement(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	e, err := h.svc.GetEntitlement(c.Request.Context(), userID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, entitlementView{
		IsPro:     e.IsPro,
		ProductID: e.ProductID,
		Store:     e.Store,
		ExpiresAt: e.ExpiresAt,
		WillRenew: e.WillRenew,
	})
}

// webhook POST /v1/billing/revenuecat/webhook — RevenueCat 推续订/退款/过期事件.
// 鉴权靠 Authorization 头与 REVENUECAT_WEBHOOK_AUTH 比对 (service 内做).
func (h *Handler) webhook(c *gin.Context) {
	body, err := io.ReadAll(c.Request.Body)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "read body"})
		return
	}
	if err := h.svc.HandleWebhook(c.Request.Context(), c.GetHeader("Authorization"), body); err != nil {
		if errors.Is(err, ErrUnauthorized) {
			c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
			return
		}
		// 其它错误回 500 —— RevenueCat 会按退避重投, 不会丢事件.
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.Status(http.StatusNoContent)
}
