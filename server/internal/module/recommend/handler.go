package recommend

import (
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register — P0 只挂内部端点 (X-Internal-Token 守门, 默认 loopback-only). 无 public 端点:
// 画像是后台派生物, 本期无任何面向用户的读/写; 重算供运维/验证手动触发, P1 起改 cron.
func (h *Handler) Register(internalV1 *gin.RouterGroup) {
	internalV1.POST("/recommend/profile/rebuild", h.rebuild)
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
