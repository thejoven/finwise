package admin

import (
	"errors"
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

// Register 挂到 adminV1 (/v1/admin, 已过 Bearer + RequireAdmin).
func (h *Handler) Register(adminV1 *gin.RouterGroup) {
	adminV1.GET("/stats/overview", h.getOverview)
	adminV1.GET("/inference/health", h.getInferenceHealth)
	adminV1.GET("/users/:id/overview", h.getUserOverview)
}

// ───── DTOs ─────

type usersBlock struct {
	Total    int `json:"total"`
	Active7d int `json:"active_7d"`
	Admins   int `json:"admins"`
}

type signalsBlock struct {
	Today   int `json:"today"`
	Total   int `json:"total"`
	Pending int `json:"pending"`
	Failed  int `json:"failed"`
}

type tweetsBlock struct {
	Today           int `json:"today"`
	Total           int `json:"total"`
	ClassifyPending int `json:"classify_pending"`
	ClassifyFailed  int `json:"classify_failed"`
}

type subscriptionsBlock struct {
	Accounts     int        `json:"accounts"`
	ActiveSubs   int        `json:"active_subs"`
	PollerLastAt *time.Time `json:"poller_last_at"`
}

// pipelineBlock 研判漏斗各阶段近 30 天计数 (holdings_active 为当前在持).
type pipelineBlock struct {
	Signals30d     int `json:"signals_30d"`
	RefineDone     int `json:"refine_done"`
	Distilled      int `json:"distilled"`
	GateTotal      int `json:"gate_total"`
	GatePassed     int `json:"gate_passed"`
	Signed         int `json:"signed"`
	HoldingsActive int `json:"holdings_active"`
}

type overviewResponse struct {
	Users           usersBlock         `json:"users"`
	Signals         signalsBlock       `json:"signals"`
	Tweets          tweetsBlock        `json:"tweets"`
	Subscriptions   subscriptionsBlock `json:"subscriptions"`
	Pipeline        pipelineBlock      `json:"pipeline"`
	GatePassRate30d float64            `json:"gate_pass_rate_30d"`
}

type inferenceFailureDTO struct {
	SignalID    string    `json:"signal_id"`
	UserID      string    `json:"user_id"`
	Email       string    `json:"email"`
	TextPreview string    `json:"text_preview"`
	CapturedAt  time.Time `json:"captured_at"`
}

type inferenceHealthResponse struct {
	Pending           int                   `json:"pending"`
	Failed            int                   `json:"failed"`
	Done              int                   `json:"done"`
	AvgLatencySeconds float64               `json:"avg_latency_seconds"`
	RecentFailures    []inferenceFailureDTO `json:"recent_failures"`
}

// ───── Handlers ─────

func (h *Handler) getOverview(c *gin.Context) {
	v, err := h.svc.GetOverview(c.Request.Context())
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, overviewResponse{
		Users: usersBlock{
			Total:    v.UsersTotal,
			Active7d: v.UsersActive7d,
			Admins:   v.UsersAdmins,
		},
		Signals: signalsBlock{
			Today:   v.SignalsToday,
			Total:   v.SignalsTotal,
			Pending: v.SignalsPending,
			Failed:  v.SignalsFailed,
		},
		Tweets: tweetsBlock{
			Today:           v.TweetsToday,
			Total:           v.TweetsTotal,
			ClassifyPending: v.TweetsClassifyPending,
			ClassifyFailed:  v.TweetsClassifyFailed,
		},
		Subscriptions: subscriptionsBlock{
			Accounts:     v.SubsAccounts,
			ActiveSubs:   v.SubsActive,
			PollerLastAt: v.PollerLastAt,
		},
		Pipeline: pipelineBlock{
			Signals30d:     v.PipeSignals30d,
			RefineDone:     v.PipeRefineDone,
			Distilled:      v.PipeDistilled,
			GateTotal:      v.PipeGateTotal,
			GatePassed:     v.PipeGatePassed,
			Signed:         v.PipeSigned,
			HoldingsActive: v.PipeHoldingsActive,
		},
		GatePassRate30d: v.GatePassRate30d,
	})
}

func (h *Handler) getInferenceHealth(c *gin.Context) {
	v, err := h.svc.GetInferenceHealth(c.Request.Context(), 20)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	failures := make([]inferenceFailureDTO, len(v.RecentFailures))
	for i, f := range v.RecentFailures {
		failures[i] = inferenceFailureDTO{
			SignalID:    f.SignalID.String(),
			UserID:      f.UserID.String(),
			Email:       f.Email,
			TextPreview: f.TextPreview,
			CapturedAt:  f.CapturedAt,
		}
	}
	c.JSON(http.StatusOK, inferenceHealthResponse{
		Pending:           v.Pending,
		Failed:            v.Failed,
		Done:              v.Done,
		AvgLatencySeconds: v.AvgLatencySeconds,
		RecentFailures:    failures,
	})
}

type userOverviewResponse struct {
	ID                  string     `json:"id"`
	Email               string     `json:"email"`
	DisplayName         string     `json:"display_name,omitempty"`
	IsAdmin             bool       `json:"is_admin"`
	CreatedAt           time.Time  `json:"created_at"`
	SignalsTotal        int        `json:"signals_total"`
	SignalsPending      int        `json:"signals_pending"`
	SignalsFailed       int        `json:"signals_failed"`
	RefineCompleted     int        `json:"refine_completed"`
	GateTotal           int        `json:"gate_total"`
	GatePassed          int        `json:"gate_passed"`
	CommitmentsSigned   int        `json:"commitments_signed"`
	HoldingsActive      int        `json:"holdings_active"`
	SubscriptionsActive int        `json:"subscriptions_active"`
	LastSignalAt        *time.Time `json:"last_signal_at,omitempty"`
}

// getUserOverview GET /v1/admin/users/:id/overview — 单用户跨域旅程快照.
func (h *Handler) getUserOverview(c *gin.Context) {
	id, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "bad user id"})
		return
	}
	v, err := h.svc.GetUserOverview(c.Request.Context(), id)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "user not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	resp := userOverviewResponse{
		ID:                  v.ID.String(),
		Email:               v.Email,
		IsAdmin:             v.IsAdmin,
		CreatedAt:           v.CreatedAt,
		SignalsTotal:        v.SignalsTotal,
		SignalsPending:      v.SignalsPending,
		SignalsFailed:       v.SignalsFailed,
		RefineCompleted:     v.RefineCompleted,
		GateTotal:           v.GateTotal,
		GatePassed:          v.GatePassed,
		CommitmentsSigned:   v.CommitmentsSigned,
		HoldingsActive:      v.HoldingsActive,
		SubscriptionsActive: v.SubscriptionsActive,
		LastSignalAt:        v.LastSignalAt,
	}
	if v.DisplayName != nil {
		resp.DisplayName = *v.DisplayName
	}
	c.JSON(http.StatusOK, resp)
}
