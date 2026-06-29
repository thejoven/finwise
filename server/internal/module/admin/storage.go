package admin

import (
	"context"
	"errors"
	"strings"

	"alphax/server/internal/module/settings"
)

// errStorageDeps 表示对象存储依赖未注入 (装配遗漏). 正常不应出现.
var errStorageDeps = errors.New("storage deps not wired")

// StorageConfigView 是后台展示用的对象存储配置 — 不含明文 secret.
type StorageConfigView struct {
	settings.StorageConfig
	SecretConfigured bool
}

// GetStorageConfig 读对象存储配置 (secret 抹掉, 仅给 SecretConfigured 标志).
func (s *Service) GetStorageConfig(ctx context.Context) (StorageConfigView, error) {
	if s.settings == nil {
		return StorageConfigView{}, errStorageDeps
	}
	cfg, err := s.settings.GetStorageConfig(ctx)
	if err != nil {
		return StorageConfigView{}, err
	}
	secretSet := cfg.SecretAccessKey != ""
	cfg.SecretAccessKey = ""
	return StorageConfigView{StorageConfig: cfg, SecretConfigured: secretSet}, nil
}

// SaveStorageConfigInput 是保存入参. SecretAccessKey 为 nil/空 = 保留原值 (不覆盖).
type SaveStorageConfigInput struct {
	Enabled         bool
	AccountID       string
	Endpoint        string
	Region          string
	Bucket          string
	AccessKeyID     string
	SecretAccessKey *string
}

// SaveStorageConfig 合并保存对象存储配置 (secret 留空则保留旧值), 返回更新后的脱敏视图.
func (s *Service) SaveStorageConfig(ctx context.Context, in SaveStorageConfigInput) (StorageConfigView, error) {
	if s.settings == nil {
		return StorageConfigView{}, errStorageDeps
	}
	cur, err := s.settings.GetStorageConfig(ctx)
	if err != nil {
		return StorageConfigView{}, err
	}
	next := settings.StorageConfig{
		Enabled:         in.Enabled,
		AccountID:       in.AccountID,
		Endpoint:        in.Endpoint,
		Region:          in.Region,
		Bucket:          in.Bucket,
		AccessKeyID:     in.AccessKeyID,
		SecretAccessKey: cur.SecretAccessKey, // 默认保留
	}
	if in.SecretAccessKey != nil && strings.TrimSpace(*in.SecretAccessKey) != "" {
		next.SecretAccessKey = *in.SecretAccessKey
	}
	if err := s.settings.SetStorageConfig(ctx, next); err != nil {
		return StorageConfigView{}, err
	}
	return s.GetStorageConfig(ctx)
}

// TestStorage 连通性自检 (BucketExists). 未配置/连不上返回 error.
func (s *Service) TestStorage(ctx context.Context) error {
	if s.storage == nil {
		return errStorageDeps
	}
	return s.storage.Test(ctx)
}
