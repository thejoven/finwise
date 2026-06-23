// Package config loads runtime configuration from env (12-factor).
// Intentionally tiny: no viper, no koanf. If it grows past one screen, revisit.
package config

import (
	"errors"
	"fmt"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
)

type Config struct {
	DatabaseURL string
	IIIHTTPURL  string // iii engine HTTP worker base URL, e.g. http://host.docker.internal:3111
	Port        int
	LogLevel    string

	// DevUserID is the single user_id used in Phase 1 (no auth yet).
	DevUserID uuid.UUID

	// DevBearerToken is the static bearer the mobile client sends on /v1/*.
	DevBearerToken string

	// InternalToken is the shared secret the Mastra worker sends on /v1/internal/*.
	InternalToken string

	// InternalLoopback enforces 127.0.0.1 on internal routes. Recommended true
	// in single-host dev, false when Mastra runs in another container.
	InternalLoopback bool

	// Outbox publisher tuning. Defaults below match what was previously hardcoded.
	OutboxPollInterval time.Duration // OUTBOX_POLL_MS, default 500ms
	OutboxBatchSize    int           // OUTBOX_BATCH,   default 10
	OutboxMaxAttempts  int           // OUTBOX_MAX_ATTEMPTS, default 5

	// Mastra HTTP 服务 (G2 ConsensusCheck / M9 Editor / M11 Diagnostician).
	// 空 → 走 stub (Go 侧的启发式 fallback), 不阻塞主流程.
	MastraHTTPURL string

	// XProvider — 选哪个 X 数据源实现 (X_PROVIDER, 默认 "twtapi"). 由 cmd/api 的
	// provider 工厂解析; 加新供应商在那里加一个 case, 订阅模块无感.
	XProvider string

	// TwtAPIKey — twtapi.com 的 X-API-Key (XProvider="twtapi" 时采集推文用).
	// 空 → poller 不启动, 订阅 REST 仍可读历史数据 (优雅降级).
	TwtAPIKey string

	// TwitterDataToken — pro.twitterdata.com 的 token (XProvider="twitterdata" 时用, query 参数鉴权).
	TwitterDataToken string

	// SubscriptionPollEnabled — 显式关闭采集 worker (调试/省配额), 默认 true.
	SubscriptionPollEnabled bool

	// MarketDataProvider — 行情源 adapter 名 (标的追踪 P1). 空/未知 → tencent (默认).
	MarketDataProvider string

	// AssetPricePollEnabled — 行情同步 worker 开关 (调试/省请求), 默认 true.
	AssetPricePollEnabled bool

	// Recovery sweeper — 自动复活被 LLM 偶发抽风搁浅的 signal/tweet (见 module/recovery).
	RecoveryEnabled       bool          // RECOVERY_ENABLED, default true
	RecoverySweepInterval time.Duration // RECOVERY_SWEEP_MS, default 120000 (2min)
	RecoveryCooldown      time.Duration // RECOVERY_COOLDOWN_MS, default 300000 (5min)
	RecoveryMaxRevivals   int           // RECOVERY_MAX_REVIVALS, default 5
	RecoveryBatchSize     int           // RECOVERY_BATCH, default 50

	// Recommend (主动信号推荐 P1 策展漏斗) tuning. 仅 recommend.Curator 消费.
	RecRelevanceMin        float64 // REC_RELEVANCE_MIN, 候选 relevance 阈值, default 0.5
	RecPerCommitmentQuota  int     // REC_PER_COMMITMENT_QUOTA, 每命题活跃推荐硬上限, default 2
	RecCandidateWindowDays int     // REC_CANDIDATE_WINDOW_DAYS, 候选推文时间窗(天), default 14

	// RevenueCatWebhookAuth — RevenueCat webhook 配的 Authorization 头明文 (共享密钥).
	// 空 → billing webhook 拒收所有请求 (fail closed); 设了才接收续订/退款/过期事件.
	RevenueCatWebhookAuth string

	// ASRServiceURL — alphax-asr (GLM-ASR CPU 推理) 的内部地址, 语音转写代理用.
	// 默认本机 loopback; 服务未起/未配时 POST /v1/signals/transcribe 返回 502/503.
	ASRServiceURL string
}

func Load() (*Config, error) {
	c := &Config{
		DatabaseURL:    os.Getenv("DATABASE_URL"),
		IIIHTTPURL:     os.Getenv("III_HTTP_URL"),
		LogLevel:       strings.ToLower(getDefault("LOG_LEVEL", "info")),
		DevBearerToken: os.Getenv("DEV_BEARER_TOKEN"),
		InternalToken:  os.Getenv("INTERNAL_TOKEN"),
	}

	port, err := strconv.Atoi(getDefault("PORT", "8080"))
	if err != nil {
		return nil, fmt.Errorf("PORT not an int: %w", err)
	}
	c.Port = port

	devUserStr := os.Getenv("DEV_USER_ID")
	if devUserStr != "" {
		uid, err := uuid.Parse(devUserStr)
		if err != nil {
			return nil, fmt.Errorf("DEV_USER_ID not a uuid: %w", err)
		}
		c.DevUserID = uid
	}

	if v := os.Getenv("INTERNAL_LOOPBACK"); v != "" {
		c.InternalLoopback = strings.EqualFold(v, "true") || v == "1"
	} else {
		c.InternalLoopback = true // safe default
	}

	pollMs, err := strconv.Atoi(getDefault("OUTBOX_POLL_MS", "500"))
	if err != nil || pollMs < 50 {
		return nil, fmt.Errorf("OUTBOX_POLL_MS must be int ≥ 50: %v", err)
	}
	c.OutboxPollInterval = time.Duration(pollMs) * time.Millisecond

	batch, err := strconv.Atoi(getDefault("OUTBOX_BATCH", "10"))
	if err != nil || batch < 1 || batch > 1000 {
		return nil, fmt.Errorf("OUTBOX_BATCH must be int in [1, 1000]: %v", err)
	}
	c.OutboxBatchSize = batch

	maxAttempts, err := strconv.Atoi(getDefault("OUTBOX_MAX_ATTEMPTS", "5"))
	if err != nil || maxAttempts < 1 {
		return nil, fmt.Errorf("OUTBOX_MAX_ATTEMPTS must be int ≥ 1: %v", err)
	}
	c.OutboxMaxAttempts = maxAttempts

	c.MastraHTTPURL = os.Getenv("MASTRA_HTTP_URL") // optional
	c.XProvider = strings.ToLower(getDefault("X_PROVIDER", "twtapi"))
	c.TwtAPIKey = os.Getenv("TWTAPI_API_KEY")           // optional
	c.TwitterDataToken = os.Getenv("TWITTERDATA_TOKEN") // optional (XProvider=twitterdata 时需要)

	if v := os.Getenv("SUBSCRIPTION_POLL_ENABLED"); v != "" {
		c.SubscriptionPollEnabled = strings.EqualFold(v, "true") || v == "1"
	} else {
		c.SubscriptionPollEnabled = true
	}

	c.MarketDataProvider = os.Getenv("MARKETDATA_PROVIDER") // optional; factory 默认 tencent

	c.RevenueCatWebhookAuth = os.Getenv("REVENUECAT_WEBHOOK_AUTH") // optional; 空 → billing webhook fail closed
	c.ASRServiceURL = getDefault("ASR_SERVICE_URL", "http://127.0.0.1:18900")
	if v := os.Getenv("ASSET_PRICE_POLL_ENABLED"); v != "" {
		c.AssetPricePollEnabled = strings.EqualFold(v, "true") || v == "1"
	} else {
		c.AssetPricePollEnabled = true
	}

	if v := os.Getenv("RECOVERY_ENABLED"); v != "" {
		c.RecoveryEnabled = strings.EqualFold(v, "true") || v == "1"
	} else {
		c.RecoveryEnabled = true
	}

	recSweepMs, err := strconv.Atoi(getDefault("RECOVERY_SWEEP_MS", "120000"))
	if err != nil || recSweepMs < 1000 {
		return nil, fmt.Errorf("RECOVERY_SWEEP_MS must be int ≥ 1000: %v", err)
	}
	c.RecoverySweepInterval = time.Duration(recSweepMs) * time.Millisecond

	recCooldownMs, err := strconv.Atoi(getDefault("RECOVERY_COOLDOWN_MS", "300000"))
	if err != nil || recCooldownMs < 1000 {
		return nil, fmt.Errorf("RECOVERY_COOLDOWN_MS must be int ≥ 1000: %v", err)
	}
	c.RecoveryCooldown = time.Duration(recCooldownMs) * time.Millisecond

	recMaxRevivals, err := strconv.Atoi(getDefault("RECOVERY_MAX_REVIVALS", "5"))
	if err != nil || recMaxRevivals < 1 {
		return nil, fmt.Errorf("RECOVERY_MAX_REVIVALS must be int ≥ 1: %v", err)
	}
	c.RecoveryMaxRevivals = recMaxRevivals

	recBatch, err := strconv.Atoi(getDefault("RECOVERY_BATCH", "50"))
	if err != nil || recBatch < 1 || recBatch > 1000 {
		return nil, fmt.Errorf("RECOVERY_BATCH must be int in [1, 1000]: %v", err)
	}
	c.RecoveryBatchSize = recBatch

	relMin, err := strconv.ParseFloat(getDefault("REC_RELEVANCE_MIN", "0.5"), 64)
	if err != nil || relMin < 0 || relMin > 1 {
		return nil, fmt.Errorf("REC_RELEVANCE_MIN must be float in [0,1]: %v", err)
	}
	c.RecRelevanceMin = relMin

	recQuota, err := strconv.Atoi(getDefault("REC_PER_COMMITMENT_QUOTA", "2"))
	if err != nil || recQuota < 1 || recQuota > 50 {
		return nil, fmt.Errorf("REC_PER_COMMITMENT_QUOTA must be int in [1,50]: %v", err)
	}
	c.RecPerCommitmentQuota = recQuota

	recWindow, err := strconv.Atoi(getDefault("REC_CANDIDATE_WINDOW_DAYS", "14"))
	if err != nil || recWindow < 1 || recWindow > 365 {
		return nil, fmt.Errorf("REC_CANDIDATE_WINDOW_DAYS must be int in [1,365]: %v", err)
	}
	c.RecCandidateWindowDays = recWindow

	var missing []string
	if c.DatabaseURL == "" {
		missing = append(missing, "DATABASE_URL")
	}
	if c.IIIHTTPURL == "" {
		missing = append(missing, "III_HTTP_URL")
	}
	if c.DevUserID == uuid.Nil {
		missing = append(missing, "DEV_USER_ID")
	}
	if c.DevBearerToken == "" {
		missing = append(missing, "DEV_BEARER_TOKEN")
	}
	if c.InternalToken == "" {
		missing = append(missing, "INTERNAL_TOKEN")
	}
	if len(missing) > 0 {
		return nil, errors.New("missing required env: " + strings.Join(missing, ", "))
	}

	return c, nil
}

func getDefault(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}
