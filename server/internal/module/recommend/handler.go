package recommend

import (
	"context"
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

// Register — P1 起有面向用户的读/反馈端点 (publicV1, Bearer) + 内部重算/策展 (internalV1).
func (h *Handler) Register(publicV1, internalV1 *gin.RouterGroup) {
	// 公开 (Bearer): 承诺相关情报 + 反馈闭环. (:id 与 commitment 模块同名, gin 不冲突.)
	publicV1.GET("/commitments/:id/related", h.commitmentRelated)
	publicV1.POST("/recommendations/:id/dismiss", h.dismiss)
	publicV1.POST("/recommendations/:id/seen", h.seen)
	// 内部 (X-Internal-Token): 画像重算 + 策展触发 (cron 化前的手动入口).
	internalV1.POST("/recommend/profile/rebuild", h.rebuild)
	internalV1.POST("/recommend/build", h.build)
}

type rebuildRequest struct {
	// UserID 给定 → 只重算该用户并回显其画像; 留空 → 全量重算 (有行为的用户), 回显汇总.
	UserID string `json:"user_id"`
}

// rebuild — POST /v1/internal/recommend/profile/rebuild
func (h *Handler) rebuild(c *gin.Context) {
	var req rebuildRequest
	_ = c.ShouldBindJSON(&req) // 字段全可选; 空 body = 全量重算

	if req.UserID != "" {
		uid, err := uuid.Parse(req.UserID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		p, err := h.svc.RebuildUser(c.Request.Context(), uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"profile": toProfileDTO(p)})
		return
	}

	res, err := h.svc.RebuildAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// ───────── DTO (回包形态; 与持久化形态解耦) ─────────

type profileDTO struct {
	UserID           string             `json:"user_id"`
	SampleSize       int                `json:"sample_size"`
	BuiltFromUntil   *time.Time         `json:"built_from_until"`
	TagAffinity      map[string]float64 `json:"tag_affinity"`
	CategoryAffinity map[string]float64 `json:"category_affinity"`
	ConvictionShape  ConvictionShape    `json:"conviction_shape"`
	Weaknesses       Weaknesses         `json:"self_known_weaknesses"`
	ActiveTheses     []Thesis           `json:"active_theses"`
}

func toProfileDTO(p *Profile) profileDTO {
	theses := p.ActiveTheses
	if theses == nil {
		theses = []Thesis{}
	}
	tags := p.TagAffinity
	if tags == nil {
		tags = map[string]float64{}
	}
	cats := p.CategoryAffinity
	if cats == nil {
		cats = map[string]float64{}
	}
	return profileDTO{
		UserID:           p.UserID.String(),
		SampleSize:       p.SampleSize,
		BuiltFromUntil:   p.BuiltFromUntil,
		TagAffinity:      tags,
		CategoryAffinity: cats,
		ConvictionShape:  p.Conviction,
		Weaknesses:       p.Weaknesses,
		ActiveTheses:     theses,
	}
}

// ───────────────────────── P1 · 承诺相关情报 + 反馈 + 策展触发 ─────────────────────────

// commitmentRelated — GET /v1/commitments/:id/related —— 该承诺的相关情报 (空 → 前端不渲染).
func (h *Handler) commitmentRelated(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	cid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	items, err := h.svc.RelatedForCommitment(c.Request.Context(), userID, cid)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	out := make([]relatedItemDTO, 0, len(items))
	for _, it := range items {
		out = append(out, toRelatedDTO(it))
	}
	c.JSON(http.StatusOK, gin.H{"items": out}) // items 为空 = 沉默 (前端不渲染空槽)
}

// dismiss — POST /v1/recommendations/:id/dismiss (用户点"不相关", 负反馈).
func (h *Handler) dismiss(c *gin.Context) { h.feedback(c, h.svc.Dismiss) }

// seen — POST /v1/recommendations/:id/seen (展开即标记已呈现).
func (h *Handler) seen(c *gin.Context) { h.feedback(c, h.svc.Seen) }

func (h *Handler) feedback(c *gin.Context, action func(ctx context.Context, userID, recID uuid.UUID) error) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "unauthorized"})
		return
	}
	rid, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	switch err := action(c.Request.Context(), userID, rid); {
	case errors.Is(err, ErrNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
	case err != nil:
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
	default:
		c.Status(http.StatusNoContent)
	}
}

// build — POST /v1/internal/recommend/build —— 按 user 或全量跑策展 (cron 化前的手动入口).
func (h *Handler) build(c *gin.Context) {
	var req rebuildRequest
	_ = c.ShouldBindJSON(&req) // 字段全可选; 空 body = 全量策展
	if req.UserID != "" {
		uid, err := uuid.Parse(req.UserID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
			return
		}
		res, err := h.svc.CurateUser(c.Request.Context(), uid)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, res)
		return
	}
	res, err := h.svc.CurateAll(c.Request.Context())
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, res)
}

// relatedItemDTO — 承诺相关情报的回包行.
type relatedItemDTO struct {
	RecID          string     `json:"rec_id"`
	TweetID        string     `json:"tweet_id"`
	Score          float32    `json:"score"`
	Rationale      string     `json:"rationale"`
	Status         string     `json:"status"`
	Handle         string     `json:"handle,omitempty"`
	TweetText      string     `json:"tweet_text"`
	TweetSummary   string     `json:"tweet_summary,omitempty"`
	TweetCreatedAt *time.Time `json:"tweet_created_at,omitempty"`
}

func toRelatedDTO(it RelatedItem) relatedItemDTO {
	return relatedItemDTO{
		RecID:          it.RecID.String(),
		TweetID:        it.TweetID,
		Score:          it.Score,
		Rationale:      it.Rationale,
		Status:         it.Status,
		Handle:         it.Handle,
		TweetText:      it.TweetText,
		TweetSummary:   it.TweetSummary,
		TweetCreatedAt: it.TweetCreatedAt,
	}
}
