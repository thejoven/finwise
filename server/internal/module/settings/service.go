package settings

import (
	"context"
	"encoding/json"
	"errors"
	"strings"
	"sync"
)

// storageKey 是对象存储配置在 app_settings 里的 key.
const storageKey = "storage.r2"

// StorageConfig 是对象存储 (Cloudflare R2 / S3-compatible) 的运行时配置.
// 后台可配, 持久化到 app_settings. SecretAccessKey 敏感, 不出后台 (handler 层屏蔽).
type StorageConfig struct {
	Enabled         bool   `json:"enabled"`
	AccountID       string `json:"account_id"` // R2 账号 ID; endpoint 由它派生
	Endpoint        string `json:"endpoint"`   // 可选: 覆盖 endpoint (自托管 MinIO / 自定义域)
	Region          string `json:"region"`     // 默认 "auto"
	Bucket          string `json:"bucket"`
	AccessKeyID     string `json:"access_key_id"`
	SecretAccessKey string `json:"secret_access_key"`
}

// ResolveEndpoint 返回 minio client 用的 host (无 scheme). 优先显式 Endpoint,
// 否则按 R2 规则从 AccountID 派生. 都空则返回空串 (视为未配置).
func (c StorageConfig) ResolveEndpoint() string {
	if e := strings.TrimSpace(c.Endpoint); e != "" {
		e = strings.TrimPrefix(e, "https://")
		e = strings.TrimPrefix(e, "http://")
		return strings.TrimRight(e, "/")
	}
	if c.AccountID != "" {
		return c.AccountID + ".r2.cloudflarestorage.com"
	}
	return ""
}

// Complete 判断配置是否足以建 client 并启用 (缺任一必填即视为未配置).
func (c StorageConfig) Complete() bool {
	return c.Enabled &&
		c.ResolveEndpoint() != "" &&
		c.Bucket != "" &&
		c.AccessKeyID != "" &&
		c.SecretAccessKey != ""
}

type Service struct {
	repo *Repository

	mu     sync.RWMutex
	cached *StorageConfig // nil = 未加载; 写时失效
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// GetStorageConfig 读对象存储配置 (进程内缓存). 未配置过 → 默认值 (Enabled=false).
func (s *Service) GetStorageConfig(ctx context.Context) (StorageConfig, error) {
	s.mu.RLock()
	if s.cached != nil {
		c := *s.cached
		s.mu.RUnlock()
		return c, nil
	}
	s.mu.RUnlock()

	cfg := defaultStorageConfig()
	raw, err := s.repo.Get(ctx, storageKey)
	switch {
	case err == nil:
		if uerr := json.Unmarshal(raw, &cfg); uerr != nil {
			return StorageConfig{}, uerr
		}
	case errors.Is(err, ErrNotFound):
		// 用默认值
	default:
		return StorageConfig{}, err
	}

	s.mu.Lock()
	s.cached = &cfg
	s.mu.Unlock()
	return cfg, nil
}

// SetStorageConfig 归一化后写库并失效缓存.
func (s *Service) SetStorageConfig(ctx context.Context, cfg StorageConfig) error {
	cfg.normalize()
	raw, err := json.Marshal(cfg)
	if err != nil {
		return err
	}
	if err := s.repo.Upsert(ctx, storageKey, raw); err != nil {
		return err
	}
	s.mu.Lock()
	s.cached = &cfg
	s.mu.Unlock()
	return nil
}

func defaultStorageConfig() StorageConfig {
	return StorageConfig{Region: "auto"}
}

func (c *StorageConfig) normalize() {
	c.AccountID = strings.TrimSpace(c.AccountID)
	c.Endpoint = strings.TrimSpace(c.Endpoint)
	c.Region = strings.TrimSpace(c.Region)
	if c.Region == "" {
		c.Region = "auto"
	}
	c.Bucket = strings.TrimSpace(c.Bucket)
	c.AccessKeyID = strings.TrimSpace(c.AccessKeyID)
	// SecretAccessKey 不 trim — 保守不动 (理论上不含空白).
}
