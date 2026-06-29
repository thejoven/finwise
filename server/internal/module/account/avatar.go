package account

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"strings"
	"time"

	"github.com/google/uuid"

	"alphax/server/internal/infra/objstore"
)

// 头像链路: 客户端向 R2 预签名直传 → confirm 校验落 avatar_object_key → 读经后端签名 URL 私有代理.
const (
	avatarKeyPrefix = "avatars/"
	maxAvatarBytes  = 5 << 20 // 5 MiB
	avatarUploadTTL = 5 * time.Minute
)

// allowedAvatarTypes 是 confirm 阶段接受的对象 Content-Type (客户端裁剪压缩后上传).
var allowedAvatarTypes = map[string]bool{
	"image/jpeg": true,
	"image/png":  true,
	"image/webp": true,
}

var (
	// ErrStorageUnavailable 对象存储未配置/未启用 (后台还没填 R2 凭证).
	ErrStorageUnavailable = errors.New("storage unavailable")
	// ErrAvatarTooLarge confirm 时对象超过大小上限.
	ErrAvatarTooLarge = errors.New("avatar too large")
	// ErrAvatarBadType confirm 时对象类型不在白名单.
	ErrAvatarBadType = errors.New("avatar unsupported type")
)

// avatarKey 头像对象键 — 确定性派生 (每次覆盖同 key, 无孤儿对象).
func avatarKey(userID uuid.UUID) string { return avatarKeyPrefix + userID.String() }

func (s *Service) storageReady(ctx context.Context) bool {
	return s.storage != nil && s.storage.IsConfigured(ctx)
}

// CreateAvatarUploadURL 生成预签名 PUT URL (客户端直传 R2). 未配置存储 → ErrStorageUnavailable.
func (s *Service) CreateAvatarUploadURL(ctx context.Context, userID uuid.UUID) (string, time.Time, error) {
	if !s.storageReady(ctx) {
		return "", time.Time{}, ErrStorageUnavailable
	}
	u, err := s.storage.PresignPut(ctx, avatarKey(userID), avatarUploadTTL)
	if err != nil {
		return "", time.Time{}, err
	}
	return u.String(), time.Now().Add(avatarUploadTTL), nil
}

// ConfirmAvatar 校验已直传对象 (存在/大小/类型) 并落 avatar_object_key.
// 不合格 → 删对象 + 返回对应错误. 对象不存在 (客户端没真传) → objstore.ErrObjectNotFound.
func (s *Service) ConfirmAvatar(ctx context.Context, userID uuid.UUID) (*PublicUser, error) {
	if !s.storageReady(ctx) {
		return nil, ErrStorageUnavailable
	}
	key := avatarKey(userID)
	size, ctype, err := s.storage.Stat(ctx, key)
	if err != nil {
		return nil, err // 含 objstore.ErrObjectNotFound
	}
	if size > maxAvatarBytes {
		_ = s.storage.Remove(ctx, key)
		return nil, ErrAvatarTooLarge
	}
	if !allowedAvatarTypes[normalizeContentType(ctype)] {
		_ = s.storage.Remove(ctx, key)
		return nil, ErrAvatarBadType
	}
	u, err := s.repo.SetAvatarKey(ctx, userID, &key)
	if err != nil {
		return nil, err
	}
	return toPublic(u), nil
}

// RemoveAvatar 清 avatar_object_key 并删对象 (best-effort).
func (s *Service) RemoveAvatar(ctx context.Context, userID uuid.UUID) (*PublicUser, error) {
	u, err := s.repo.SetAvatarKey(ctx, userID, nil)
	if err != nil {
		return nil, err
	}
	if s.storage != nil {
		_ = s.storage.Remove(ctx, avatarKey(userID))
	}
	return toPublic(u), nil
}

// OpenAvatar 打开某用户头像读流 (读代理). 无对象 → objstore.ErrObjectNotFound; 未配置 → ErrStorageUnavailable.
func (s *Service) OpenAvatar(ctx context.Context, userID uuid.UUID) (io.ReadCloser, string, int64, error) {
	if !s.storageReady(ctx) {
		return nil, "", 0, ErrStorageUnavailable
	}
	return s.storage.Get(ctx, avatarKey(userID))
}

// normalizeContentType 去掉 "; charset=..." 之类参数并小写, 便于白名单比对.
func normalizeContentType(ct string) string {
	if i := strings.IndexByte(ct, ';'); i >= 0 {
		ct = ct[:i]
	}
	return strings.ToLower(strings.TrimSpace(ct))
}

// ────── 头像 URL 签名器 ──────

// AvatarSigner 给私有读代理签发短期 URL. 因原生 SwiftUI Image / <img> 无法附带 Authorization 头,
// 读端点 (/v1/avatars/:id) 挂在 anon 组, 靠 HMAC 签名 (?exp=&sig=) 自证. key 从 server secret 派生.
type AvatarSigner struct {
	key []byte
	ttl time.Duration
}

// NewAvatarSigner 从 server secret 派生独立 HMAC key (不直接用原文).
func NewAvatarSigner(secret string, ttl time.Duration) *AvatarSigner {
	sum := sha256.Sum256([]byte("alphax/avatar-url/v1:" + secret))
	return &AvatarSigner{key: sum[:], ttl: ttl}
}

// SignedPath 返回相对路径 /v1/avatars/<id>?exp=&sig=&v=<version>. version 仅用于浏览器/RN 缓存清除.
func (s *AvatarSigner) SignedPath(userID uuid.UUID, version int64) string {
	exp := time.Now().Add(s.ttl).Unix()
	sig := s.compute(userID.String(), exp)
	return fmt.Sprintf("/v1/avatars/%s?exp=%d&sig=%s&v=%d", userID, exp, sig, version)
}

// Verify 校验签名匹配且未过期.
func (s *AvatarSigner) Verify(id string, exp int64, sig string) bool {
	if exp <= 0 || time.Now().Unix() > exp {
		return false
	}
	want := s.compute(id, exp)
	return hmac.Equal([]byte(want), []byte(sig))
}

func (s *AvatarSigner) compute(id string, exp int64) string {
	mac := hmac.New(sha256.New, s.key)
	fmt.Fprintf(mac, "%s.%d", id, exp)
	return hex.EncodeToString(mac.Sum(nil))
}

// 让 objstore 的 not-found sentinel 在本包可被 handler errors.Is 引用 (避免 handler 直接 import objstore).
var ErrObjectNotFound = objstore.ErrObjectNotFound
