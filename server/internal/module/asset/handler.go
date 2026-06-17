package asset

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

// Register — 资产端点挂 publicV1 (Bearer). 资产全局, 任一登录用户可读价格 / 纠正一个归一.
func (h *Handler) Register(publicV1 *gin.RouterGroup) {
	publicV1.POST("/assets/resolve", h.resolve)
	publicV1.GET("/assets/:id/prices", h.prices)
}

type assetDTO struct {
	ID             string  `json:"id"`
	Canonical      string  `json:"canonical"`
	Exchange       string  `json:"exchange"`
	Market         string  `json:"market"`
	Name           string  `json:"name"`
	ProviderSymbol *string `json:"provider_symbol,omitempty"`
	Type           string  `json:"type"`
	Status         string  `json:"status"`
}

func toAssetDTO(a *Asset) assetDTO {
	return assetDTO{
		ID:             a.ID.String(),
		Canonical:      a.Canonical,
		Exchange:       a.Exchange,
		Market:         a.Market,
		Name:           a.Name,
		ProviderSymbol: a.ProviderSymbol,
		Type:           a.Type,
		Status:         a.Status,
	}
}

// resolve — POST /v1/assets/resolve. 人工兜底: 手动指定 canonical/exchange/market, 或标 untrackable.
//
//	{ "reference": "国内存储模组厂", "untrackable": true }
//	{ "reference": "宁德时代", "market": "a", "canonical": "300750", "exchange": "SZSE", "name": "宁德时代", "signal_id": "..." }
func (h *Handler) resolve(c *gin.Context) {
	if _, ok := auth.UserID(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req struct {
		Reference   string  `json:"reference"`
		SignalID    *string `json:"signal_id"`
		Untrackable bool    `json:"untrackable"`
		Canonical   string  `json:"canonical"`
		Exchange    string  `json:"exchange"`
		Market      string  `json:"market"`
		Name        string  `json:"name"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}

	in := ManualResolveInput{
		Reference:   req.Reference,
		Untrackable: req.Untrackable,
		Canonical:   req.Canonical,
		Exchange:    req.Exchange,
		Market:      req.Market,
		Name:        req.Name,
	}
	if req.SignalID != nil && *req.SignalID != "" {
		id, err := uuid.Parse(*req.SignalID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "signal_id not a uuid"})
			return
		}
		in.SignalID = &id
	}

	a, err := h.svc.ManualResolve(c.Request.Context(), in)
	if err != nil {
		switch {
		case errors.Is(err, ErrEmptyReference),
			errors.Is(err, ErrInvalidMarket),
			errors.Is(err, ErrInvalidCode),
			errors.Is(err, ErrMissingFields):
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		case errors.Is(err, ErrNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "signal not found"})
		default:
			c.Error(err) //nolint:errcheck
			c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		}
		return
	}
	c.JSON(http.StatusOK, toAssetDTO(a))
}

type barDTO struct {
	Date   string   `json:"date"` // YYYY-MM-DD
	Open   *float64 `json:"open,omitempty"`
	High   *float64 `json:"high,omitempty"`
	Low    *float64 `json:"low,omitempty"`
	Close  float64  `json:"close"`
	Volume *int64   `json:"volume,omitempty"`
}

type pricesDTO struct {
	Asset         assetDTO   `json:"asset"`
	PriceStatus   string     `json:"price_status"`              // pending|active|unsupported|failed
	PriceSyncedAt *time.Time `json:"price_synced_at,omitempty"` // 数据截至 (as-of)
	Source        string     `json:"source,omitempty"`          // 行情出处 (eastmoney…)
	Bars          []barDTO   `json:"bars"`
}

// prices — GET /v1/assets/:id/prices?from=YYYY-MM-DD&to=YYYY-MM-DD. 原始日线 + 数据出处/as-of.
func (h *Handler) prices(c *gin.Context) {
	if _, ok := auth.UserID(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	var from, to time.Time
	if v := c.Query("from"); v != "" {
		if from, err = time.Parse("2006-01-02", v); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "from must be YYYY-MM-DD"})
			return
		}
	}
	if v := c.Query("to"); v != "" {
		if to, err = time.Parse("2006-01-02", v); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "to must be YYYY-MM-DD"})
			return
		}
	}

	view, err := h.svc.Prices(c.Request.Context(), id, from, to)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}

	bars := make([]barDTO, 0, len(view.Bars))
	source := ""
	for _, b := range view.Bars {
		if source == "" {
			source = b.Source
		}
		bars = append(bars, barDTO{
			Date:   b.Date.Format("2006-01-02"),
			Open:   b.Open,
			High:   b.High,
			Low:    b.Low,
			Close:  b.Close,
			Volume: b.Volume,
		})
	}
	c.JSON(http.StatusOK, pricesDTO{
		Asset:         toAssetDTO(&view.Asset),
		PriceStatus:   view.PriceStatus,
		PriceSyncedAt: view.PriceSyncedAt,
		Source:        source,
		Bars:          bars,
	})
}
