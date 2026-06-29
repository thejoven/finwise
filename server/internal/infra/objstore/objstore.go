// Package objstore 是对象存储 (Cloudflare R2 / S3-compatible) 适配器, 基于 minio-go.
//
// 配置来自 settings.Service (后台可配, 运行时可变), 故底层 client 按"当前配置指纹"惰性
// 构建并缓存 — 配置变更 (指纹变) 即重建. 未配置 → IsConfigured()=false, 调用方回 503.
//
// 头像链路用法: 预签名 PUT (客户端直传) → Stat (confirm 校验) → Get (后端签名 URL 私有读代理).
package objstore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"

	"github.com/minio/minio-go/v7"
	"github.com/minio/minio-go/v7/pkg/credentials"

	"alphax/server/internal/module/settings"
)

var (
	// ErrNotConfigured 表示对象存储尚未在后台配置 (或被禁用).
	ErrNotConfigured = errors.New("object storage not configured")
	// ErrObjectNotFound 表示对象键不存在 (Stat/Get 未命中).
	ErrObjectNotFound = errors.New("object not found")
)

// Storage 是头像上传/读取依赖的对象存储能力. key 为完整对象键 (调用方负责拼前缀).
type Storage interface {
	// IsConfigured 当前是否有可用配置 (Enabled + 必填齐全).
	IsConfigured(ctx context.Context) bool
	// PresignPut 给 key 生成有效期 expiry 的预签名 PUT URL (客户端直传).
	PresignPut(ctx context.Context, key string, expiry time.Duration) (*url.URL, error)
	// Stat 取对象大小/类型. 对象不存在 → ErrObjectNotFound.
	Stat(ctx context.Context, key string) (size int64, contentType string, err error)
	// Get 打开对象读流 (读代理). 调用方负责 Close. 对象不存在 → ErrObjectNotFound.
	Get(ctx context.Context, key string) (rc io.ReadCloser, contentType string, size int64, err error)
	// Remove 删除对象 (confirm 校验不过 / 用户移除头像). 对象不存在不报错.
	Remove(ctx context.Context, key string) error
	// Test 连通性自检 (后台"测试连接": BucketExists).
	Test(ctx context.Context) error
}

type adapter struct {
	settings *settings.Service

	mu          sync.Mutex
	client      *minio.Client
	bucket      string
	fingerprint string
}

// New 返回一个由 settings.Service 驱动的对象存储适配器.
func New(s *settings.Service) Storage {
	return &adapter{settings: s}
}

func (a *adapter) IsConfigured(ctx context.Context) bool {
	cfg, err := a.settings.GetStorageConfig(ctx)
	return err == nil && cfg.Complete()
}

// clientFor 返回与当前配置匹配的 minio client + 桶名. 配置变更则重建.
func (a *adapter) clientFor(ctx context.Context) (*minio.Client, string, error) {
	cfg, err := a.settings.GetStorageConfig(ctx)
	if err != nil {
		return nil, "", err
	}
	if !cfg.Complete() {
		return nil, "", ErrNotConfigured
	}
	fp := fingerprint(cfg)

	a.mu.Lock()
	defer a.mu.Unlock()
	if a.client != nil && a.fingerprint == fp {
		return a.client, a.bucket, nil
	}
	cl, err := minio.New(cfg.ResolveEndpoint(), &minio.Options{
		Creds:  credentials.NewStaticV4(cfg.AccessKeyID, cfg.SecretAccessKey, ""),
		Secure: true,
		Region: cfg.Region,
	})
	if err != nil {
		return nil, "", fmt.Errorf("init object storage client: %w", err)
	}
	a.client = cl
	a.bucket = cfg.Bucket
	a.fingerprint = fp
	return cl, cfg.Bucket, nil
}

func (a *adapter) PresignPut(ctx context.Context, key string, expiry time.Duration) (*url.URL, error) {
	cl, bucket, err := a.clientFor(ctx)
	if err != nil {
		return nil, err
	}
	return cl.PresignedPutObject(ctx, bucket, key, expiry)
}

func (a *adapter) Stat(ctx context.Context, key string) (int64, string, error) {
	cl, bucket, err := a.clientFor(ctx)
	if err != nil {
		return 0, "", err
	}
	info, err := cl.StatObject(ctx, bucket, key, minio.StatObjectOptions{})
	if err != nil {
		if isNotFound(err) {
			return 0, "", ErrObjectNotFound
		}
		return 0, "", fmt.Errorf("stat object: %w", err)
	}
	return info.Size, info.ContentType, nil
}

func (a *adapter) Get(ctx context.Context, key string) (io.ReadCloser, string, int64, error) {
	cl, bucket, err := a.clientFor(ctx)
	if err != nil {
		return nil, "", 0, err
	}
	obj, err := cl.GetObject(ctx, bucket, key, minio.GetObjectOptions{})
	if err != nil {
		return nil, "", 0, fmt.Errorf("get object: %w", err)
	}
	// GetObject 惰性, 错误在首次 Stat/Read 才浮现 — 这里先 Stat 把 not-found 提前暴露.
	info, err := obj.Stat()
	if err != nil {
		_ = obj.Close()
		if isNotFound(err) {
			return nil, "", 0, ErrObjectNotFound
		}
		return nil, "", 0, fmt.Errorf("stat object stream: %w", err)
	}
	return obj, info.ContentType, info.Size, nil
}

func (a *adapter) Remove(ctx context.Context, key string) error {
	cl, bucket, err := a.clientFor(ctx)
	if err != nil {
		return err
	}
	return cl.RemoveObject(ctx, bucket, key, minio.RemoveObjectOptions{})
}

func (a *adapter) Test(ctx context.Context) error {
	cl, bucket, err := a.clientFor(ctx)
	if err != nil {
		return err
	}
	ok, err := cl.BucketExists(ctx, bucket)
	if err != nil {
		return fmt.Errorf("bucket check: %w", err)
	}
	if !ok {
		return fmt.Errorf("bucket %q not found or not accessible", bucket)
	}
	return nil
}

func fingerprint(c settings.StorageConfig) string {
	sum := sha256.Sum256([]byte(c.ResolveEndpoint() + "|" + c.Region + "|" + c.Bucket + "|" + c.AccessKeyID + "|" + c.SecretAccessKey))
	return hex.EncodeToString(sum[:])
}

func isNotFound(err error) bool {
	resp := minio.ToErrorResponse(err)
	return resp.StatusCode == http.StatusNotFound || resp.Code == "NoSuchKey"
}
