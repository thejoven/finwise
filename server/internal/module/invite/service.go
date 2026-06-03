package invite

import (
	"context"
	"crypto/rand"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

// ErrInvalidInput 入参校验失败 (label 过长 / max_uses 非正 / expires 非正 等).
var ErrInvalidInput = errors.New("invalid input")

// codeAlphabet 是生成/规范化邀请码用的无歧义字母表: 去掉 0/O/1/I/L/U.
// 大写, 兑换时把用户输入 upper + 仅保留这些字符, 容忍空格/连字符/大小写.
const codeAlphabet = "ABCDEFGHJKMNPQRSTVWXYZ23456789"

// codeLen 生成码长度. 30^10 ≈ 5.9e14, 配合吊销/过期, HTTP 暴力不可行.
const codeLen = 10

const (
	maxLabelRunes  = 80
	maxCreateUses  = 100000
	maxExpiresDays = 3650
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// ────── Create ──────

// CreateCommand 是管理员新建邀请码的入参. 全部可选: 默认不限次、永不过期.
type CreateCommand struct {
	Label         *string
	MaxUses       *int
	ExpiresInDays *int
	CreatedBy     *uuid.UUID
}

func (c *CreateCommand) normalize() error {
	if c.Label != nil {
		v := strings.TrimSpace(*c.Label)
		if v == "" {
			c.Label = nil
		} else if utf8.RuneCountInString(v) > maxLabelRunes {
			return fmt.Errorf("%w: label too long", ErrInvalidInput)
		} else {
			c.Label = &v
		}
	}
	if c.MaxUses != nil {
		if *c.MaxUses < 1 || *c.MaxUses > maxCreateUses {
			return fmt.Errorf("%w: max_uses must be 1..%d", ErrInvalidInput, maxCreateUses)
		}
	}
	if c.ExpiresInDays != nil {
		if *c.ExpiresInDays < 1 || *c.ExpiresInDays > maxExpiresDays {
			return fmt.Errorf("%w: expires_in_days must be 1..%d", ErrInvalidInput, maxExpiresDays)
		}
	}
	return nil
}

// Create 生成并落库一个新邀请码. 码撞唯一索引会重试几次 (概率极低).
func (s *Service) Create(ctx context.Context, cmd CreateCommand) (*InviteCode, error) {
	if err := cmd.normalize(); err != nil {
		return nil, err
	}
	var expiresAt *time.Time
	if cmd.ExpiresInDays != nil {
		t := time.Now().Add(time.Duration(*cmd.ExpiresInDays) * 24 * time.Hour)
		expiresAt = &t
	}

	const maxAttempts = 5
	for attempt := 0; attempt < maxAttempts; attempt++ {
		code, err := newCode()
		if err != nil {
			return nil, fmt.Errorf("gen code: %w", err)
		}
		ic, err := s.repo.Create(ctx, CreateInput{
			ID:        uuid.New(),
			Code:      code,
			Label:     cmd.Label,
			MaxUses:   cmd.MaxUses,
			ExpiresAt: expiresAt,
			CreatedBy: cmd.CreatedBy,
		})
		if err != nil {
			if errors.Is(err, ErrCodeExists) {
				continue // 撞码, 换一个再试
			}
			return nil, err
		}
		return ic, nil
	}
	return nil, fmt.Errorf("gen unique code: exhausted %d attempts", maxAttempts)
}

// List 返回全部邀请码 (新→旧).
func (s *Service) List(ctx context.Context) ([]InviteCode, error) {
	return s.repo.List(ctx)
}

// Revoke 吊销邀请码.
func (s *Service) Revoke(ctx context.Context, id uuid.UUID) (*InviteCode, error) {
	return s.repo.Revoke(ctx, id)
}

// ────── Redeem / Refund (给 account.Register 经闭包调用) ──────

// Redeem 规范化用户输入后原子消费一次. 空码或不可兑换返回 ErrNotRedeemable.
func (s *Service) Redeem(ctx context.Context, rawCode string) error {
	code := NormalizeCode(rawCode)
	if code == "" {
		return ErrNotRedeemable
	}
	return s.repo.Redeem(ctx, code)
}

// Refund 退回一次额度 (注册后续失败时补偿). 同样先规范化.
func (s *Service) Refund(ctx context.Context, rawCode string) error {
	code := NormalizeCode(rawCode)
	if code == "" {
		return nil
	}
	return s.repo.Refund(ctx, code)
}

// ────── helpers ──────

// NormalizeCode 把用户输入折成规范形式: 大写后只保留字母表内字符 (容忍空格/连字符).
func NormalizeCode(s string) string {
	s = strings.ToUpper(s)
	var b strings.Builder
	for _, r := range s {
		if strings.ContainsRune(codeAlphabet, r) {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// newCode 用 crypto/rand 从无歧义字母表抽 codeLen 个字符.
func newCode() (string, error) {
	buf := make([]byte, codeLen)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	out := make([]byte, codeLen)
	for i, v := range buf {
		out[i] = codeAlphabet[int(v)%len(codeAlphabet)]
	}
	return string(out), nil
}

// Status 派生邀请码状态, 给后台展示用. now 由调用方传 (便于一致/测试).
func (ic InviteCode) Status(now time.Time) string {
	switch {
	case ic.RevokedAt != nil:
		return "revoked"
	case ic.ExpiresAt != nil && !ic.ExpiresAt.After(now):
		return "expired"
	case ic.MaxUses != nil && ic.Uses >= *ic.MaxUses:
		return "exhausted"
	default:
		return "active"
	}
}
