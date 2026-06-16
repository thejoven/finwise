package distillation

import (
	"encoding/json"
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

func (h *Handler) Register(publicV1, internalV1, adminV1 *gin.RouterGroup) {
	publicV1.GET("/distillations/:refinementID", h.get)
	internalV1.POST("/distillation", h.upsert)
	adminV1.GET("/distillations", h.adminList)
}

// ───── DTOs ─────

type upsertRequest struct {
	RefinementID     string          `json:"refinement_id"`
	UserID           string          `json:"user_id"`
	DistilledContent *string         `json:"distilled_content"`
	Beneficiary      json.RawMessage `json:"beneficiary"`
	BeneficiaryNote  *string         `json:"beneficiary_note"`
	Model            string          `json:"model"`
}

// getResponse — beneficiary 三态原样回给客户端:
//
//	null   → 金融 agent 还在推演 (降噪页继续 poll)
//	[]     → 推演完无受益映射 → 降噪页留白
//	[ … ]  → 收益标的信号
type getResponse struct {
	RefinementID     string          `json:"refinement_id"`
	DistilledContent *string         `json:"distilled_content"`
	Beneficiary      json.RawMessage `json:"beneficiary"`
	BeneficiaryNote  *string         `json:"beneficiary_note"`
	Model            string          `json:"model"`
	CreatedAt        time.Time       `json:"created_at"`
	UpdatedAt        time.Time       `json:"updated_at"`
}

// ───── Handlers ─────

func (h *Handler) get(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	refID, err := uuid.Parse(c.Param("refinementID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refinementID not a uuid"})
		return
	}
	d, err := h.svc.Get(c.Request.Context(), userID, refID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, getResponse{
		RefinementID:     d.RefinementID.String(),
		DistilledContent: d.DistilledContent,
		Beneficiary:      d.Beneficiary,
		BeneficiaryNote:  d.BeneficiaryNote,
		Model:            d.Model,
		CreatedAt:        d.CreatedAt,
		UpdatedAt:        d.UpdatedAt,
	})
}

func (h *Handler) upsert(c *gin.Context) {
	var req upsertRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	refID, err := uuid.Parse(req.RefinementID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "refinement_id not a uuid"})
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}
	// JSON body 里 "beneficiary": null 会被解成 RawMessage("null") (4 字节), 不是 nil.
	// 归一成 nil, 否则会把 SQL 列写成 jsonb 'null' (≠ SQL NULL), 破坏 COALESCE 合并语义.
	benef := req.Beneficiary
	if len(benef) == 0 || string(benef) == "null" {
		benef = nil
	}
	_, err = h.svc.Upsert(c.Request.Context(), UpsertInput{
		RefinementID:     refID,
		UserID:           userID,
		DistilledContent: req.DistilledContent,
		Beneficiary:      benef,
		BeneficiaryNote:  req.BeneficiaryNote,
		Model:            req.Model,
	})
	if err != nil {
		if errors.Is(err, ErrInvalidInput) {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "recorded"})
}
