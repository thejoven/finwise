package asset

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

// Register — 资产端点挂 publicV1 (Bearer). 资产全局, 任一登录用户可读价格 / 纠正一个归一.
// track 端点跨表只读 (承诺/信号 → signal_assets → asset_prices), 用既有 :id 参数名, 不与
// commitment/signal 模块的 /:id 路由冲突.
func (h *Handler) Register(publicV1 *gin.RouterGroup) {
	publicV1.POST("/assets/resolve", h.resolve)
	publicV1.GET("/assets/:id/prices", h.prices)
	publicV1.GET("/assets/:id/theses", h.assetTheses)
	publicV1.GET("/commitments/:id/track", h.commitmentTrack)
	publicV1.GET("/signals/:id/track", h.signalTrack)
	publicV1.GET("/track/assets", h.trackAssets)
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

// ───────────────────────── track (发现后走势) ─────────────────────────

type trackBarDTO struct {
	Date  string  `json:"date"` // YYYY-MM-DD
	Close float64 `json:"close"`
}

type trackDTO struct {
	Asset             assetDTO      `json:"asset"`
	Role              string        `json:"role"`
	AnchorAt          time.Time     `json:"anchor_at"` // 发现时刻 (冻结)
	AnchorClose       *float64      `json:"anchor_close,omitempty"`
	SignedAt          *time.Time    `json:"signed_at,omitempty"` // 承诺签字日 (信号 track 无)
	SignClose         *float64      `json:"sign_close,omitempty"`
	LatestClose       *float64      `json:"latest_close,omitempty"`
	LatestDate        *string       `json:"latest_date,omitempty"`
	PctSinceDiscovery *float64      `json:"pct_since_discovery,omitempty"`
	PctSinceSign      *float64      `json:"pct_since_sign,omitempty"`
	Source            string        `json:"source,omitempty"`
	Bars              []trackBarDTO `json:"bars"`
}

func toTrackDTO(t Track) trackDTO {
	bars := make([]trackBarDTO, 0, len(t.Bars))
	for _, b := range t.Bars {
		bars = append(bars, trackBarDTO{Date: b.Date.Format("2006-01-02"), Close: b.Close})
	}
	dto := trackDTO{
		Asset: toAssetDTO(&t.Asset), Role: t.Role, AnchorAt: t.AnchorAt,
		AnchorClose: t.AnchorClose, SignedAt: t.SignedAt, SignClose: t.SignClose,
		LatestClose: t.LatestClose, PctSinceDiscovery: t.PctSinceDiscovery,
		PctSinceSign: t.PctSinceSign, Source: t.Source, Bars: bars,
	}
	if t.LatestDate != nil {
		s := t.LatestDate.Format("2006-01-02")
		dto.LatestDate = &s
	}
	return dto
}

func toTrackDTOs(tracks []Track) []trackDTO {
	out := make([]trackDTO, 0, len(tracks))
	for _, t := range tracks {
		out = append(out, toTrackDTO(t))
	}
	return out
}

// commitmentTrack — GET /v1/commitments/:id/track. 承诺标的发现后走势 + 签字日锚点 ("我押对没").
func (h *Handler) commitmentTrack(c *gin.Context) {
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
	v, err := h.svc.CommitmentTrack(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "commitment not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"commitment_id": v.CommitmentID.String(),
		"signed_at":     v.SignedAt,
		"thesis_asset":  v.ThesisAsset,
		"tracks":        toTrackDTOs(v.Tracks),
	})
}

// signalTrack — GET /v1/signals/:id/track. 信号标的发现后走势 (无签字日). 无相关标的 → tracks: [].
func (h *Handler) signalTrack(c *gin.Context) {
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
	v, err := h.svc.SignalTrack(c.Request.Context(), userID, id)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"signal_id": v.SignalID.String(),
		"tracks":    toTrackDTOs(v.Tracks),
	})
}

// ───────────────────────── 标的专页反查 (P4) ─────────────────────────

type thesisDTO struct {
	Kind             string     `json:"kind"` // "signal" | "commitment"
	SignalID         string     `json:"signal_id"`
	CapturedAt       time.Time  `json:"captured_at"`
	AnchorAt         time.Time  `json:"anchor_at"`
	Role             string     `json:"role"`
	Rationale        *string    `json:"rationale,omitempty"`
	Summary          *string    `json:"summary,omitempty"`
	CommitmentID     *string    `json:"commitment_id,omitempty"`
	CommitmentStatus *string    `json:"commitment_status,omitempty"`
	SignedAt         *time.Time `json:"signed_at,omitempty"`
	Action           *string    `json:"action,omitempty"`
}

// assetTheses — GET /v1/assets/:id/theses. 标的专页: 我碰过这只标的的全部命题 (信号 + 派生承诺).
func (h *Handler) assetTheses(c *gin.Context) {
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
	v, err := h.svc.AssetTheses(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "asset not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]thesisDTO, 0, len(v.Theses))
	for _, t := range v.Theses {
		d := thesisDTO{
			Kind: "signal", SignalID: t.SignalID.String(), CapturedAt: t.CapturedAt,
			AnchorAt: t.AnchorAt, Role: t.Role, Rationale: t.Rationale, Summary: t.Summary,
			CommitmentStatus: t.CommitmentStatus, SignedAt: t.SignedAt, Action: t.Action,
		}
		if t.CommitmentID != nil {
			s := t.CommitmentID.String()
			d.CommitmentID = &s
			d.Kind = "commitment"
		}
		out = append(out, d)
	}
	c.JSON(http.StatusOK, gin.H{"asset": toAssetDTO(&v.Asset), "theses": out})
}

// ───────────────────────── 标的追踪页 (§6.6) ─────────────────────────

type assetCardDTO struct {
	Asset             assetDTO   `json:"asset"`
	PriceStatus       string     `json:"price_status"`
	PriceSyncedAt     *time.Time `json:"price_synced_at,omitempty"`
	LastTouched       time.Time  `json:"last_touched"`
	ThesisCount       int        `json:"thesis_count"`
	LatestClose       *float64   `json:"latest_close,omitempty"`
	LatestDate        *string    `json:"latest_date,omitempty"`
	PctSinceDiscovery *float64   `json:"pct_since_discovery,omitempty"`
}

// trackAssets — GET /v1/track/assets. 标的追踪页「关联标的」: 罗列用户碰过的全部标的.
// 信号/订阅不在此 (各有专门端点); 标的段上限见 service.trackedAssetsCap.
func (h *Handler) trackAssets(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}

	cards, err := h.svc.TrackedAssetCards(c.Request.Context(), userID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}

	assets := make([]assetCardDTO, 0, len(cards))
	for _, a := range cards {
		d := assetCardDTO{
			Asset: toAssetDTO(&a.Asset), PriceStatus: a.PriceStatus, PriceSyncedAt: a.PriceSyncedAt,
			LastTouched: a.LastTouched, ThesisCount: a.ThesisCount,
			LatestClose: a.LatestClose, PctSinceDiscovery: a.PctSinceDiscovery,
		}
		if a.LatestDate != nil {
			s := a.LatestDate.Format("2006-01-02")
			d.LatestDate = &s
		}
		assets = append(assets, d)
	}

	c.JSON(http.StatusOK, gin.H{"assets": assets})
}
