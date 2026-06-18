package signal

import (
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"alphax/server/internal/domain"
	"alphax/server/internal/httpapi/auth"
)

// Handler hosts the HTTP entry points for the signal module.
type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register attaches routes to the route groups.
// - publicV1: /v1, requires the dev bearer / session token
// - internalV1: /v1/internal, requires the shared internal secret
// - adminV1: /v1/admin, requires Bearer + RequireAdmin
func (h *Handler) Register(publicV1, internalV1, adminV1 *gin.RouterGroup) {
	publicV1.POST("/signals", h.capture)
	publicV1.GET("/signals", h.list)
	publicV1.GET("/signals/:id", h.get)
	publicV1.POST("/signals/:id/reinfer", h.reinfer)

	internalV1.POST("/inferences", h.recordInference)

	adminV1.GET("/signals", h.adminList)
	// 运营按需重推 (失败/卡住的推断兜底). 静态 /signals/reinfer 与参数 /signals/:id/reinfer
	// 同级共存 — gin 1.10 支持 (参照 /commitments/active vs /commitments/:id).
	adminV1.POST("/signals/:id/reinfer", h.adminReinfer)
	adminV1.POST("/signals/reinfer", h.adminReinferFailed)
}

// ───────── DTOs (kept inside the package — module-private contract) ─────────

type captureRequest struct {
	ClientEventID string    `json:"client_event_id"`
	ProjectID     *string   `json:"project_id,omitempty"`
	RawText       string    `json:"raw_text"`
	OccurredAt    time.Time `json:"occurred_at"`
}

type captureResponse struct {
	SignalID        string  `json:"signal_id"`
	EventID         int64   `json:"event_id"`
	InferenceStatus string  `json:"inference_status"`
	Duplicate       bool    `json:"duplicate"`
	ProjectID       *string `json:"project_id,omitempty"`
}

type signalView struct {
	ID               string                `json:"id"`
	ProjectID        *string               `json:"project_id,omitempty"`
	RawText          string                `json:"raw_text"`
	CapturedAt       time.Time             `json:"captured_at"`
	InferenceStatus  string                `json:"inference_status"`
	InferenceSummary *string               `json:"inference_summary,omitempty"`
	InferenceTags    []string              `json:"inference_tags,omitempty"`
	RelatedAssets    []domain.RelatedAsset `json:"related_assets,omitempty"`
}

type listResponse struct {
	Signals []signalView `json:"signals"`
	HasMore bool         `json:"has_more"`
}

type inferenceRequest struct {
	SignalID      string                `json:"signal_id"`
	UserID        string                `json:"user_id"`
	Summary       string                `json:"summary"`
	Tags          []string              `json:"tags"`
	Model         string                `json:"model"`
	RelatedAssets []domain.RelatedAsset `json:"related_assets"`
	Layer         *string               `json:"cognitive_layer"`
	Consensus     *string               `json:"consensus_check"`
	ProjectID     *string               `json:"project_id"` // AI 判断的分类 (可空 = 弃权)
}

// ───────── Handlers ─────────

func (h *Handler) capture(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}

	var req captureRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}

	cid, err := uuid.Parse(req.ClientEventID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_event_id not a uuid"})
		return
	}

	var projectID *uuid.UUID
	if req.ProjectID != nil && *req.ProjectID != "" {
		pid, err := uuid.Parse(*req.ProjectID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project_id not a uuid"})
			return
		}
		projectID = &pid
	}

	res, err := h.svc.Capture(c.Request.Context(), CaptureCommand{
		UserID:        userID,
		ClientEventID: cid,
		ProjectID:     projectID,
		RawText:       req.RawText,
		OccurredAt:    req.OccurredAt,
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}

	resp := captureResponse{
		SignalID:        res.Signal.ID.String(),
		EventID:         res.EventID,
		InferenceStatus: string(res.Signal.InferenceStatus),
		Duplicate:       res.Duplicate,
	}
	if res.Signal.ProjectID != nil {
		s := res.Signal.ProjectID.String()
		resp.ProjectID = &s
	}
	// 202 even on duplicate — the client should treat the response as the truth
	// and update its local state idempotently.
	c.JSON(http.StatusAccepted, resp)
}

func (h *Handler) list(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}

	limit := 20
	if s := c.Query("limit"); s != "" {
		if n, err := strconv.Atoi(s); err == nil {
			limit = n
		}
	}
	var before *time.Time
	if s := c.Query("before"); s != "" {
		t, err := time.Parse(time.RFC3339, s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "before not RFC3339"})
			return
		}
		before = &t
	}
	var projectID *uuid.UUID
	if s := c.Query("project_id"); s != "" {
		pid, err := uuid.Parse(s)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "project_id not a uuid"})
			return
		}
		projectID = &pid
	}

	signals, hasMore, err := h.svc.List(c.Request.Context(), userID, ListFilter{
		Before:     before,
		Limit:      limit,
		Query:      c.Query("q"),
		ProjectID:  projectID,
		HasTargets: c.Query("has_targets") == "true",
	})
	if err != nil {
		writeServiceError(c, err)
		return
	}

	views := make([]signalView, len(signals))
	for i, s := range signals {
		views[i] = toSignalView(s)
	}
	c.JSON(http.StatusOK, listResponse{Signals: views, HasMore: hasMore})
}

func (h *Handler) get(c *gin.Context) {
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

	s, err := h.svc.Get(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, toSignalView(*s))
}

// reinfer — 用户主动触发: 这条 signal 卡在 pending (mastra LLM DLQ 了),
// 重新发一次 signal.captured 进 NATS 队列让 analyst 重跑.
// 不属于该 user → 404; 已 done → 409 (没必要重跑).
func (h *Handler) reinfer(c *gin.Context) {
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

	sig, err := h.svc.Reinfer(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if errors.Is(err, ErrInferenceDone) {
			c.JSON(http.StatusConflict, gin.H{"error": "inference already done"})
			return
		}
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{
		"signal_id":        sig.ID.String(),
		"inference_status": string(sig.InferenceStatus),
		"reinfer_enqueued": true,
	})
}

func (h *Handler) recordInference(c *gin.Context) {
	var req inferenceRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}

	signalID, err := uuid.Parse(req.SignalID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "signal_id not a uuid"})
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}

	var layer *domain.CognitiveLayer
	if req.Layer != nil {
		l := domain.CognitiveLayer(*req.Layer)
		layer = &l
	}
	var consensus *domain.ConsensusCheck
	if req.Consensus != nil {
		v := domain.ConsensusCheck(*req.Consensus)
		consensus = &v
	}

	// AI 判断的分类 (可空). 解析失败按"未提供"处理 (当弃权), 不让一个坏字段毁掉整条推演回写.
	var aiProjectID *uuid.UUID
	if req.ProjectID != nil && *req.ProjectID != "" {
		if pid, perr := uuid.Parse(*req.ProjectID); perr == nil {
			aiProjectID = &pid
		}
	}

	if err := h.svc.RecordInference(c.Request.Context(), InferenceCommand{
		SignalID:      signalID,
		UserID:        userID,
		Summary:       req.Summary,
		Tags:          req.Tags,
		Model:         req.Model,
		RelatedAssets: req.RelatedAssets,
		Layer:         layer,
		Consensus:     consensus,
		ProjectID:     aiProjectID,
	}); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "signal not found"})
			return
		}
		writeServiceError(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "recorded"})
}

func toSignalView(s domain.Signal) signalView {
	v := signalView{
		ID:               s.ID.String(),
		RawText:          s.RawText,
		CapturedAt:       s.CapturedAt,
		InferenceStatus:  string(s.InferenceStatus),
		InferenceSummary: s.InferenceSummary,
		InferenceTags:    s.InferenceTags,
		RelatedAssets:    s.InferenceRelatedAssets,
	}
	if s.ProjectID != nil {
		pid := s.ProjectID.String()
		v.ProjectID = &pid
	}
	return v
}

func writeServiceError(c *gin.Context, err error) {
	if errors.Is(err, ErrInvalidInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if errors.Is(err, ErrInvalidProject) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid project_id"})
		return
	}
	c.Error(err) //nolint:errcheck // gin logs it via middleware
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
}
