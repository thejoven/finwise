package subscription

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
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

// Register — 全部挂 publicV1 (Bearer). 本模块无 internal 端点 (分类回写是
// Go 主动调 Mastra 后直接 UPDATE, 见开发计划 §0).
func (h *Handler) Register(publicV1 *gin.RouterGroup) {
	publicV1.GET("/subscriptions", h.listSubscriptions)
	publicV1.GET("/subscriptions/resolve", h.resolve)
	publicV1.POST("/subscriptions", h.subscribe)
	publicV1.DELETE("/subscriptions/:id", h.unsubscribe)

	publicV1.GET("/tweets", h.feed)
	publicV1.GET("/tweets/unread-count", h.unreadCount)
	publicV1.POST("/tweets/read-all", h.readAll)
	publicV1.GET("/tweets/:id", h.getTweet)
	publicV1.POST("/tweets/:id/read", h.markRead)
	publicV1.POST("/tweets/:id/promote", h.promote)
}

// ───── DTOs ─────

type subscriptionDTO struct {
	ID           string     `json:"id"`
	SourceType   string     `json:"source_type"`
	Handle       string     `json:"handle"`
	DisplayName  string     `json:"display_name"`
	AvatarURL    string     `json:"avatar_url"`
	Bio          string     `json:"bio,omitempty"`
	Status       string     `json:"status"`
	UnreadCount  int        `json:"unread_count"`
	LastPolledAt *time.Time `json:"last_polled_at,omitempty"`
	CreatedAt    time.Time  `json:"created_at"`
}

func toSubscriptionDTO(v SubscriptionView) subscriptionDTO {
	return subscriptionDTO{
		ID:           v.ID.String(),
		SourceType:   v.SourceType,
		Handle:       v.Handle,
		DisplayName:  v.DisplayName,
		AvatarURL:    v.AvatarURL,
		Bio:          v.Bio,
		Status:       v.Status,
		UnreadCount:  v.UnreadCount,
		LastPolledAt: v.LastPolledAt,
		CreatedAt:    v.CreatedAt,
	}
}

type tweetDTO struct {
	ID             string          `json:"id"`
	SubscriptionID string          `json:"subscription_id"`
	Handle         string          `json:"handle"`
	DisplayName    string          `json:"display_name"`
	AvatarURL      string          `json:"avatar_url"`
	Text           string          `json:"text"`
	Lang           string          `json:"lang,omitempty"`
	TweetCreatedAt time.Time       `json:"tweet_created_at"`
	IsRetweet      bool            `json:"is_retweet"`
	IsQuote        bool            `json:"is_quote"`
	Media          json.RawMessage `json:"media,omitempty"`
	Metrics        json.RawMessage `json:"metrics,omitempty"`
	Tags           []string        `json:"tags,omitempty"`
	Summary        *string         `json:"summary,omitempty"`
	Category       *string         `json:"category,omitempty"`
	Relevance      *float32        `json:"relevance,omitempty"`
	ClassifyStatus string          `json:"classify_status"`
	Read           bool            `json:"read"`
}

func toTweetDTO(v TweetView) tweetDTO {
	return tweetDTO{
		ID:             v.ID,
		SubscriptionID: v.SubscriptionID.String(),
		Handle:         v.Handle,
		DisplayName:    v.DisplayName,
		AvatarURL:      v.AvatarURL,
		Text:           v.Text,
		Lang:           v.Lang,
		TweetCreatedAt: v.TweetCreatedAt,
		IsRetweet:      v.IsRetweet,
		IsQuote:        v.IsQuote,
		Media:          v.Media,
		Metrics:        v.Metrics,
		Tags:           v.Tags,
		Summary:        v.Summary,
		Category:       v.Category,
		Relevance:      v.Relevance,
		ClassifyStatus: v.ClassifyStatus,
		Read:           v.Read,
	}
}

// ───── handlers ─────

func (h *Handler) listSubscriptions(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	items, err := h.svc.ListSubscriptions(c.Request.Context(), userID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]subscriptionDTO, 0, len(items))
	for _, v := range items {
		out = append(out, toSubscriptionDTO(v))
	}
	c.JSON(http.StatusOK, gin.H{"items": out, "limit": MaxSubscriptionsPerUser})
}

// writeSubscribeErr — subscribe / resolve 共用的错误映射.
func writeSubscribeErr(c *gin.Context, err error) {
	switch {
	case errors.Is(err, ErrUnsupportedType):
		c.JSON(http.StatusBadRequest, gin.H{"error": "该类型暂不支持, 在路上了", "code": "unsupported_type"})
	case errors.Is(err, ErrInvalidHandle):
		c.JSON(http.StatusBadRequest, gin.H{"error": "handle 不合法", "code": "invalid_handle"})
	case errors.Is(err, ErrLimitReached):
		c.JSON(http.StatusConflict, gin.H{"error": "先读完手头的, 再添新的。", "code": "limit_reached"})
	case errors.Is(err, ErrAccountNotFound):
		c.JSON(http.StatusNotFound, gin.H{"error": "没有找到这个账号", "code": "account_not_found"})
	case errors.Is(err, ErrSourceUnavailable):
		c.JSON(http.StatusServiceUnavailable, gin.H{"error": "采集服务暂不可用, 稍后再试", "code": "source_unavailable"})
	default:
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
	}
}

func (h *Handler) resolve(c *gin.Context) {
	if _, ok := auth.UserID(c); !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	acct, err := h.svc.ResolveHandle(c.Request.Context(), c.Query("handle"))
	if err != nil {
		writeSubscribeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, gin.H{
		"rest_id":      acct.RestID,
		"handle":       acct.Handle,
		"display_name": acct.DisplayName,
		"avatar_url":   acct.AvatarURL,
		"bio":          acct.Bio,
	})
}

func (h *Handler) subscribe(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req struct {
		SourceType string `json:"source_type"`
		Handle     string `json:"handle"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "invalid json: " + err.Error()})
		return
	}
	view, err := h.svc.Subscribe(c.Request.Context(), userID, req.SourceType, req.Handle)
	if err != nil {
		writeSubscribeErr(c, err)
		return
	}
	c.JSON(http.StatusOK, toSubscriptionDTO(*view))
}

func (h *Handler) unsubscribe(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	subID, err := uuid.Parse(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "id not a uuid"})
		return
	}
	if err := h.svc.Unsubscribe(c.Request.Context(), userID, subID); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.Status(http.StatusNoContent)
}

func (h *Handler) feed(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	in := FeedInput{
		UserID:      userID,
		IncludeRead: c.Query("filter") == "all", // 默认 unread (产品主视图)
		Cursor:      c.Query("cursor"),
	}
	if v := c.Query("subscription_id"); v != "" {
		id, err := uuid.Parse(v)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "subscription_id not a uuid"})
			return
		}
		in.SubscriptionID = &id
	}
	if v := c.Query("limit"); v != "" {
		n, err := strconv.Atoi(v)
		if err != nil || n < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "limit must be a positive int"})
			return
		}
		in.Limit = n
	}
	items, next, hasMore, err := h.svc.Feed(c.Request.Context(), in)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	out := make([]tweetDTO, 0, len(items))
	for _, v := range items {
		out = append(out, toTweetDTO(v))
	}
	c.JSON(http.StatusOK, gin.H{"items": out, "next_cursor": next, "has_more": hasMore})
}

func (h *Handler) unreadCount(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	n, err := h.svc.UnreadCount(c.Request.Context(), userID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"unread": n})
}

func (h *Handler) getTweet(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	tw, err := h.svc.GetTweet(c.Request.Context(), userID, c.Param("id"))
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, toTweetDTO(*tw))
}

func (h *Handler) markRead(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	if err := h.svc.MarkRead(c.Request.Context(), userID, c.Param("id")); err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "read"})
}

func (h *Handler) readAll(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req struct {
		SubscriptionID *string `json:"subscription_id"`
	}
	_ = c.ShouldBindJSON(&req) // body 可空 = 全部订阅
	var subID *uuid.UUID
	if req.SubscriptionID != nil && *req.SubscriptionID != "" {
		id, err := uuid.Parse(*req.SubscriptionID)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "subscription_id not a uuid"})
			return
		}
		subID = &id
	}
	n, err := h.svc.MarkAllRead(c.Request.Context(), userID, subID)
	if err != nil {
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"marked": n})
}

func (h *Handler) promote(c *gin.Context) {
	userID, ok := auth.UserID(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "user_id missing"})
		return
	}
	var req struct {
		Note string `json:"note"`
	}
	_ = c.ShouldBindJSON(&req) // body 可空 = 原文直通
	signalID, duplicate, err := h.svc.Promote(c.Request.Context(), userID, c.Param("id"), req.Note)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			c.JSON(http.StatusNotFound, gin.H{"error": "not found"})
			return
		}
		c.Error(err) //nolint:errcheck
		c.JSON(http.StatusInternalServerError, gin.H{"error": "internal"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"signal_id": signalID.String(), "duplicate": duplicate})
}
