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

	// TwtAPIKey — twtapi.com 的 X-API-Key (订阅模块采集推文用).
	// 空 → poller 不启动, 订阅 REST 仍可读历史数据 (优雅降级).
	TwtAPIKey string

	// SubscriptionPollEnabled — 显式关闭采集 worker (调试/省配额), 默认 true.
	SubscriptionPollEnabled bool
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
	c.TwtAPIKey = os.Getenv("TWTAPI_API_KEY")      // optional

	if v := os.Getenv("SUBSCRIPTION_POLL_ENABLED"); v != "" {
		c.SubscriptionPollEnabled = strings.EqualFold(v, "true") || v == "1"
	} else {
		c.SubscriptionPollEnabled = true
	}

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
