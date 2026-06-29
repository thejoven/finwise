package billing

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// ErrUnauthorized — webhook 的 Authorization 头与配置不符, 或根本没配 secret.
var ErrUnauthorized = errors.New("unauthorized webhook")

// EntitlementID 是我们唯一认的 entitlement 标识, 与客户端 ENTITLEMENT_ID 对齐.
const EntitlementID = "pro"

type Service struct {
	repo *Repository
	// webhookAuth 是 RevenueCat webhook 配的 Authorization 头明文 (共享密钥).
	// 空 → 拒收所有 webhook (fail closed).
	webhookAuth string
	logger      *zap.Logger
}

func NewService(repo *Repository, webhookAuth string, logger *zap.Logger) *Service {
	return &Service{repo: repo, webhookAuth: webhookAuth, logger: logger}
}

// EntitlementView 是给 API / 门禁用的精炼视图.
type EntitlementView struct {
	IsPro     bool
	ProductID *string
	Store     *string
	ExpiresAt *time.Time
	WillRenew bool
}

// GetEntitlement 返回用户的 pro 订阅状态. 没有记录 → 未订阅 (IsPro=false), 非错误.
func (s *Service) GetEntitlement(ctx context.Context, userID uuid.UUID) (EntitlementView, error) {
	e, err := s.repo.GetEntitlement(ctx, userID, EntitlementID)
	if err != nil {
		return EntitlementView{}, err
	}
	if e == nil {
		return EntitlementView{}, nil
	}
	// 二次保险: 到期时间已过即视为未激活, 即使 webhook 还没把 is_active 翻成 false
	// (例如 EXPIRATION 事件延迟 / 丢失).
	isPro := e.IsActive && (e.ExpiresAt == nil || e.ExpiresAt.After(time.Now()))
	return EntitlementView{
		IsPro:     isPro,
		ProductID: e.ProductID,
		Store:     e.Store,
		ExpiresAt: e.ExpiresAt,
		WillRenew: e.WillRenew,
	}, nil
}

// rcWebhook 是 RevenueCat webhook 的外层信封. 只解我们要用的字段.
// 字段含义见 https://www.revenuecat.com/docs/webhooks/event-types-and-fields
type rcWebhook struct {
	Event rcEvent `json:"event"`
}

type rcEvent struct {
	ID             string   `json:"id"`
	Type           string   `json:"type"`
	AppUserID      string   `json:"app_user_id"`
	EntitlementIDs []string `json:"entitlement_ids"`
	ProductID      string   `json:"product_id"`
	Store          string   `json:"store"`
	Environment    string   `json:"environment"`
	ExpirationAtMs int64    `json:"expiration_at_ms"`
}

// HandleWebhook 校验来源 → 幂等记录事件 → 投影到 user_entitlements.
//
// "与我们无关"的事件 (非 pro entitlement / app_user_id 不是合法 uuid / 重复投递)
// 一律按成功跳过 —— webhook 必须回 2xx, 否则 RevenueCat 会不停重投.
func (s *Service) HandleWebhook(ctx context.Context, authHeader string, body []byte) error {
	if s.webhookAuth == "" {
		s.logger.Warn("billing: 收到 webhook 但未配置 REVENUECAT_WEBHOOK_AUTH, 拒绝 (fail closed)")
		return ErrUnauthorized
	}
	if subtle.ConstantTimeCompare([]byte(authHeader), []byte(s.webhookAuth)) != 1 {
		return ErrUnauthorized
	}

	var hook rcWebhook
	if err := json.Unmarshal(body, &hook); err != nil {
		return fmt.Errorf("decode webhook: %w", err)
	}
	ev := hook.Event
	if ev.ID == "" {
		return fmt.Errorf("webhook missing event.id")
	}

	// app_user_id 应是我们 logIn 时传的 user uuid; 匿名 / TRANSFER 等可能不是.
	var userID *uuid.UUID
	if uid, err := uuid.Parse(ev.AppUserID); err == nil {
		userID = &uid
	}

	isNew, err := s.repo.RecordEvent(ctx, EventRecord{
		EventID:     ev.ID,
		UserID:      userID,
		Type:        ev.Type,
		Environment: ev.Environment,
		Payload:     body,
	})
	if err != nil {
		return err
	}
	if !isNew {
		return nil // 重复投递, 已处理过.
	}

	// 只投影我们认的 pro entitlement, 且 app_user_id 必须能对到用户.
	if userID == nil || !containsEntitlement(ev.EntitlementIDs) {
		return nil
	}

	var expiresAt *time.Time
	if ev.ExpirationAtMs > 0 {
		t := time.UnixMilli(ev.ExpirationAtMs).UTC()
		expiresAt = &t
	}
	active, willRenew := projectStatus(ev.Type, expiresAt)

	return s.repo.UpsertEntitlement(ctx, Entitlement{
		UserID:        *userID,
		EntitlementID: EntitlementID,
		IsActive:      active,
		ProductID:     optStr(ev.ProductID),
		Store:         optStr(ev.Store),
		ExpiresAt:     expiresAt,
		WillRenew:     willRenew,
	}, ev.ID)
}

func containsEntitlement(ids []string) bool {
	for _, id := range ids {
		if id == EntitlementID {
			return true
		}
	}
	return false
}

// projectStatus 把 RevenueCat 事件类型 (+ 到期时间) 投影成 (是否激活, 是否会续订).
//
// 务实近似, 不是完整状态机: 事件自带 expiration_at_ms, 以它兜底 —— 到期已过一律
// 按未激活. 需要更权威时可改为收到事件后用 RevenueCat REST API 重新拉 subscriber
// (需 secret key), 这里先不引那条依赖.
func projectStatus(eventType string, expiresAt *time.Time) (active, willRenew bool) {
	expired := expiresAt != nil && !expiresAt.After(time.Now())
	switch eventType {
	case "INITIAL_PURCHASE", "RENEWAL", "UNCANCELLATION", "PRODUCT_CHANGE", "SUBSCRIPTION_EXTENDED":
		return !expired, !expired
	case "CANCELLATION", "NON_RENEWING_PURCHASE":
		// 仍在本期有效, 但不会自动续订.
		return !expired, false
	case "EXPIRATION", "SUBSCRIPTION_PAUSED", "BILLING_ISSUE":
		return false, false
	default:
		// TRANSFER / 未知类型: 用到期时间兜底.
		return !expired, false
	}
}

func optStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
