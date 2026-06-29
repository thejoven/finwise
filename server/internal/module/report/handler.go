package report

import (
	"encoding/json"
	"errors"
	"net/http"
	"strings"
	"time"

	"github.com/gin-gonic/gin"

	"alphax/server/internal/httpapi/auth"
	"alphax/server/internal/infra/mastra"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

func (h *Handler) Register(publicV1, internalV1, adminV1 *gin.RouterGroup) {
	publicV1.GET("/morning-report", h.get)
	publicV1.POST("/morning-report/read", h.markRead)
	adminV1.POST("/morning-report/generate", h.adminGenerate)
}

// ───── DTOs ─────

type getResponse struct {
	Available      bool                          `json:"available"`
	EditionDate    string                        `json:"edition_date"`
	Language       string                        `json:"language"`
	IsQuiet        bool                          `json:"is_quiet"`
	SignalCount    int                           `json:"signal_count"`
	Headline       *string                       `json:"headline"`
	Dek            *string                       `json:"dek"`
	Sections       []mastra.MorningReportSection `json:"sections"`
	SectionOrder   []string                      `json:"section_order"`
	PersonalIntro  *string                       `json:"personal_intro"`
	RelevantAssets []mastra.ReportPersonalAsset  `json:"relevant_assets"`
	TopAssets      json.RawMessage               `json:"top_assets"`
	TopTags        json.RawMessage               `json:"top_tags"`
	ReadAt         *time.Time                    `json:"read_at"`
}

func emptyResponse() getResponse {
	return getResponse{
		Available:      false,
		Sections:       []mastra.MorningReportSection{},
		SectionOrder:   []string{},
		RelevantAssets: []mastra.ReportPersonalAsset{},
		TopAssets:      json.RawMessage("[]"),
		TopTags:        json.RawMessage("[]"),
	}
}

func toResponse(v *UserReportView) getResponse {
	r := getResponse{
		Available:      v.Available,
		EditionDate:    v.EditionDate,
		Language:       v.Language,
		IsQuiet:        v.IsQuiet,
		SignalCount:    v.SignalCount,
		Headline:       v.Headline,
		Dek:            v.Dek,
		Sections:       coerceSections(v.Sections),
		SectionOrder:   v.SectionOrder,
		PersonalIntro:  v.PersonalIntro,
		RelevantAssets: v.RelevantAssets,
		TopAssets:      v.TopAssets,
		TopTags:        v.TopTags,
		ReadAt:         v.ReadAt,
	}
	if r.SectionOrder == nil {
		r.SectionOrder = []string{}
	}
	if r.RelevantAssets == nil {
		r.RelevantAssets = []mastra.ReportPersonalAsset{}
	}
	if len(r.TopAssets) == 0 {
		r.TopAssets = json.RawMessage("[]")
	}
	if len(r.TopTags) == 0 {
		r.TopTags = json.RawMessage("[]")
	}
	return r
}

// ───── Handlers ─────

// get — 当前用户当天 (或 ?date=) 的个性化早报. 首次打开懒构建. 无任何底稿 → 200 + available:false.
func (h *Handler) get(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	date := strings.TrimSpace(c.Query("date"))
	if date != "" {
		if _, err := time.Parse("2006-01-02", date); err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "date must be YYYY-MM-DD"})
			return
		}
	}
	view, err := h.svc.GetForUser(c.Request.Context(), userID, date)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusOK, emptyResponse())
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, toResponse(view))
}

type markReadRequest struct {
	Date string `json:"date"`
}

func (h *Handler) markRead(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req markReadRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	date := strings.TrimSpace(req.Date)
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "date must be YYYY-MM-DD"})
		return
	}
	if err := h.svc.MarkRead(c.Request.Context(), userID, date); err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "ok"})
}

type adminGenerateRequest struct {
	EditionDate string `json:"edition_date"`
}

// adminGenerate — 手动按 edition_date 生成/重刊 (免等 08:00; 测试/补刊用). 覆盖已有底稿.
func (h *Handler) adminGenerate(c *gin.Context) {
	var req adminGenerateRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	date := strings.TrimSpace(req.EditionDate)
	if _, err := time.Parse("2006-01-02", date); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "edition_date must be YYYY-MM-DD"})
		return
	}
	if err := h.svc.GenerateForEditionDate(c.Request.Context(), date); err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "generate failed: " + err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "generated", "edition_date": date})
}
