package refinement

import (
	"encoding/json"
	"errors"
	"net/http"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"flashfi/server/internal/domain"
	"flashfi/server/internal/httpapi/auth"
)

type Handler struct {
	svc *Service
}

func NewHandler(svc *Service) *Handler {
	return &Handler{svc: svc}
}

// Register 把路由挂到 v1 / internal 两个 group.
// Public 路由都在 /v1/refinement/sessions/* 下, internal 在 /v1/internal/refinement/*.
func (h *Handler) Register(publicV1, internalV1 *gin.RouterGroup) {
	pub := publicV1.Group("/refinement/sessions")
	pub.POST("", h.start)
	pub.GET("/by-signal/:signalID", h.getBySignal)
	pub.GET("/:id", h.get)
	pub.POST("/:id/answers", h.answer)
	pub.POST("/:id/reinfer-question", h.reinferQuestion)

	internalV1.POST("/refinement/sessions/:id/question", h.saveQuestion)
	internalV1.GET("/refinement/sessions/:id", h.internalGet)
}

// ───── DTOs ─────

type startRequest struct {
	ClientEventID   string  `json:"client_event_id"`
	PrimarySignalID string  `json:"primary_signal_id"`
	PrimaryAsset    *string `json:"primary_asset,omitempty"`
}

type sessionResponse struct {
	ID                   string  `json:"id"`
	PrimarySignalID      string  `json:"primary_signal_id"`
	PrimaryAsset         *string `json:"primary_asset,omitempty"`
	Status               string  `json:"status"`
	RoundsDone           int     `json:"rounds_done"`
	Decision             *string `json:"decision,omitempty"`
	StartedAt            string  `json:"started_at"`
	CompletedAt          string  `json:"completed_at,omitempty"`
	// 仅 Get 接口返回 (Start 接口的 fields 是空)
	PrimarySignalRawText string  `json:"primary_signal_raw_text,omitempty"`
	PrimarySignalSummary *string `json:"primary_signal_summary,omitempty"`
}

type sessionViewResponse struct {
	sessionResponse
	Rounds          []roundView      `json:"rounds"`
	PendingQuestion *pendingQuestion `json:"pending_question,omitempty"`

	// M11.5 闭环 · 用户最新训练重点 (Mastra Socratic prompt 注入用)
	TrainingFocusDim  string `json:"training_focus_dim,omitempty"`
	TrainingFocusText string `json:"training_focus_text,omitempty"`
}

type roundView struct {
	Round        int                     `json:"round"`
	QuestionID   string                  `json:"question_id"`
	QuestionKind domain.QuestionKind     `json:"question_kind"`
	QuestionText string                  `json:"question_text"`
	Options      []domain.QuestionOption `json:"options,omitempty"`
	Answer       domain.UserAnswer       `json:"user_answer"`
	Diagnosis    domain.AnswerDiagnosis  `json:"diagnosis"`
	AnsweredAt   string                  `json:"answered_at"`
}

type pendingQuestion struct {
	Round   int             `json:"round"`
	Payload json.RawMessage `json:"payload"`
}

type answerRequest struct {
	ClientEventID string                  `json:"client_event_id"`
	Round         int                     `json:"round"`
	QuestionID    string                  `json:"question_id"`
	QuestionKind  domain.QuestionKind     `json:"question_kind"`
	QuestionText  string                  `json:"question_text"`
	Options       []domain.QuestionOption `json:"options,omitempty"`
	Answer        domain.UserAnswer       `json:"user_answer"`
	Diagnosis     domain.AnswerDiagnosis  `json:"diagnosis"`
}

type answerResponse struct {
	NewRound  int     `json:"new_round"`
	Completed bool    `json:"completed"`
	Decision  *string `json:"decision,omitempty"`
}

type saveQuestionRequest struct {
	UserID  string          `json:"user_id"`
	Round   int             `json:"round"`
	Payload json.RawMessage `json:"payload"`
}

// ───── Handlers ─────

func (h *Handler) start(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}

	var req startRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	cid, err := uuid.Parse(req.ClientEventID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_event_id not a uuid"})
		return
	}
	sigID, err := uuid.Parse(req.PrimarySignalID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "primary_signal_id not a uuid"})
		return
	}

	session, err := h.svc.Start(c.Request.Context(), StartCommand{
		UserID:          userID,
		ClientEventID:   cid,
		PrimarySignalID: sigID,
		PrimaryAsset:    req.PrimaryAsset,
	})
	if err != nil {
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, toSessionResponse(session))
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

	view, err := h.svc.Get(c.Request.Context(), userID, id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toSessionViewResponse(view))
}

func (h *Handler) answer(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}

	var req answerRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	cid, err := uuid.Parse(req.ClientEventID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "client_event_id not a uuid"})
		return
	}

	res, err := h.svc.Answer(c.Request.Context(), AnswerCommand{
		UserID:        userID,
		ClientEventID: cid,
		SessionID:     sessionID,
		Round:         req.Round,
		QuestionID:    req.QuestionID,
		QuestionKind:  req.QuestionKind,
		QuestionText:  req.QuestionText,
		Options:       req.Options,
		Answer:        req.Answer,
		Diagnosis:     req.Diagnosis,
	})
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		if errors.Is(err, ErrAlreadyClosed) {
			c.JSON(http.StatusConflict, gin.H{"error": "session already closed"})
			return
		}
		if errors.Is(err, ErrInvalidRound) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		writeErr(c, err)
		return
	}

	resp := answerResponse{NewRound: res.NewRound, Completed: res.Completed}
	if res.Decision != nil {
		s := string(*res.Decision)
		resp.Decision = &s
	}
	c.JSON(http.StatusOK, resp)
}

// getBySignal returns the latest completed 五轮追问 session for a given signal.
// 信号详情页用 — 已完成时在底部回看历史问答. 没有就 404.
func (h *Handler) getBySignal(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	signalID, err := uuid.Parse(c.Param("signalID"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "signal_id not a uuid"})
		return
	}
	view, err := h.svc.GetLatestCompletedBySignal(c.Request.Context(), userID, signalID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "no completed refinement for this signal"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toSessionViewResponse(view))
}

// internalGet 是给 Mastra 拉 session 完整状态 (含已答轮次) 的接口.
// 走 internal token, query 参数带 user_id (Mastra 知道用户).
func (h *Handler) internalGet(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	uidStr := c.Query("user_id")
	if uidStr == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id query param required"})
		return
	}
	userID, err := uuid.Parse(uidStr)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}
	view, err := h.svc.Get(c.Request.Context(), userID, sessionID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toSessionViewResponse(view))
}

func (h *Handler) saveQuestion(c *gin.Context) {
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	var req saveQuestionRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	userID, err := uuid.Parse(req.UserID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "user_id not a uuid"})
		return
	}

	if err := h.svc.SaveQuestion(c.Request.Context(), SaveQuestionCommand{
		UserID:    userID,
		SessionID: sessionID,
		Round:     req.Round,
		Payload:   req.Payload,
	}); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "session not found"})
			return
		}
		if errors.Is(err, ErrAlreadyClosed) {
			c.JSON(http.StatusConflict, gin.H{"error": "session closed"})
			return
		}
		if errors.Is(err, ErrInvalidRound) {
			c.JSON(http.StatusConflict, gin.H{"error": err.Error()})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "saved"})
}

// ───── helpers ─────

func toSessionResponse(s *Session) sessionResponse {
	out := sessionResponse{
		ID:                   s.ID.String(),
		PrimarySignalID:      s.PrimarySignalID.String(),
		PrimaryAsset:         s.PrimaryAsset,
		Status:               s.Status,
		RoundsDone:           s.RoundsDone,
		StartedAt:            s.StartedAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		PrimarySignalRawText: s.PrimarySignalRawText,
		PrimarySignalSummary: s.PrimarySignalSummary,
	}
	if s.CompletedAt != nil {
		out.CompletedAt = s.CompletedAt.UTC().Format("2006-01-02T15:04:05Z07:00")
	}
	if s.Decision != nil {
		out.Decision = s.Decision
	}
	return out
}

func toSessionViewResponse(v *SessionView) sessionViewResponse {
	rounds := make([]roundView, len(v.Rounds))
	for i, r := range v.Rounds {
		rounds[i] = roundView{
			Round:        r.Round,
			QuestionID:   r.QuestionID,
			QuestionKind: r.QuestionKind,
			QuestionText: r.QuestionText,
			Options:      r.Options,
			Answer:       r.Answer,
			Diagnosis:    r.Diagnosis,
			AnsweredAt:   r.AnsweredAt.UTC().Format("2006-01-02T15:04:05Z07:00"),
		}
	}
	resp := sessionViewResponse{
		sessionResponse:   toSessionResponse(&v.Session),
		Rounds:            rounds,
		TrainingFocusDim:  v.TrainingFocusDim,
		TrainingFocusText: v.TrainingFocusText,
	}
	if v.Question != nil {
		resp.PendingQuestion = &pendingQuestion{Round: v.Question.Round, Payload: v.Question.Payload}
	}
	return resp
}

// reinferQuestion — 用户主动重推: 当前 session 等下一题卡住 (mastra socratic DLQ).
// 重发最近一条 refinement.answered event 让 mastra 再出一次.
func (h *Handler) reinferQuestion(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	sessionID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	if err := h.svc.ReinferQuestion(c.Request.Context(), userID, sessionID); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		if errors.Is(err, ErrAlreadyCompleted) {
			c.JSON(http.StatusConflict, gin.H{"error": "session already completed"})
			return
		}
		if errors.Is(err, ErrHasPendingQuestion) {
			c.JSON(http.StatusConflict, gin.H{"error": "session has a pending question; no need to retry"})
			return
		}
		if errors.Is(err, ErrNotStarted) {
			c.JSON(http.StatusConflict, gin.H{"error": "session has no answered round yet"})
			return
		}
		writeErr(c, err)
		return
	}
	c.JSON(http.StatusAccepted, gin.H{"reinfer_enqueued": true})
}

func writeErr(c *gin.Context, err error) {
	if errors.Is(err, ErrInvalidInput) {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	// Ownership 失败 → 404 (不暴露存在性, 与 signal.handler.get 一致).
	if errors.Is(err, ErrSignalNotOwned) {
		c.JSON(http.StatusNotFound, gin.H{"error": "signal not found"})
		return
	}
	c.Error(err) //nolint:errcheck // gin logs it via middleware
	c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
}
