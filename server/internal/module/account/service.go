package account

import (
	"context"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"fmt"
	"net/mail"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"
)

// SessionTTL 是 login 签发 session 的有效期. 单 host 个人 app, 给 30 天.
const SessionTTL = 30 * 24 * time.Hour

// MinPasswordLen 最低密码长度. 8 位是底线 — 不发邮件验证码也要至少强一点.
const MinPasswordLen = 8
const MaxPasswordLen = 128

var (
	ErrInvalidInput   = errors.New("invalid input")
	ErrBadCredentials = errors.New("bad credentials")
)

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// ────── DTO ──────

// PublicUser 是返回给客户端的 user 视图 — 不含 password_hash.
type PublicUser struct {
	ID          uuid.UUID
	Email       string
	DisplayName *string
	AvatarURL   *string
	Bio         *string
	CreatedAt   time.Time
}

func toPublic(u *User) *PublicUser {
	return &PublicUser{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Bio:         u.Bio,
		CreatedAt:   u.CreatedAt,
	}
}

// SessionToken 是 login/register 给客户端的"凭证"对.
type SessionToken struct {
	Token     string
	ExpiresAt time.Time
}

// ────── Register ──────

type RegisterCommand struct {
	Email       string
	Password    string
	DisplayName *string
}

func (c *RegisterCommand) normalize() error {
	c.Email = strings.TrimSpace(c.Email)
	if c.Email == "" {
		return fmt.Errorf("%w: email required", ErrInvalidInput)
	}
	if _, err := mail.ParseAddress(c.Email); err != nil {
		return fmt.Errorf("%w: bad email", ErrInvalidInput)
	}
	if utf8.RuneCountInString(c.Email) > 254 {
		return fmt.Errorf("%w: email too long", ErrInvalidInput)
	}
	if l := len(c.Password); l < MinPasswordLen || l > MaxPasswordLen {
		return fmt.Errorf("%w: password length must be %d..%d", ErrInvalidInput, MinPasswordLen, MaxPasswordLen)
	}
	if c.DisplayName != nil {
		name := strings.TrimSpace(*c.DisplayName)
		if name == "" {
			c.DisplayName = nil
		} else if utf8.RuneCountInString(name) > 60 {
			return fmt.Errorf("%w: display_name too long", ErrInvalidInput)
		} else {
			c.DisplayName = &name
		}
	}
	return nil
}

// Register 创建新用户, 同时签发 session token.
// 不验证邮箱 (产品决策: 邮箱注册不需要验证码).
func (s *Service) Register(ctx context.Context, cmd RegisterCommand) (*PublicUser, *SessionToken, error) {
	if err := cmd.normalize(); err != nil {
		return nil, nil, err
	}
	hash, err := hashPassword(cmd.Password)
	if err != nil {
		return nil, nil, fmt.Errorf("hash password: %w", err)
	}
	u, err := s.repo.CreateUser(ctx, CreateUserInput{
		ID:           uuid.New(),
		Email:        cmd.Email,
		PasswordHash: hash,
		DisplayName:  cmd.DisplayName,
	})
	if err != nil {
		return nil, nil, err
	}
	tok, err := s.issueSession(ctx, u.ID)
	if err != nil {
		return nil, nil, err
	}
	return toPublic(u), tok, nil
}

// ────── Login ──────

type LoginCommand struct {
	Email    string
	Password string
}

// Login 查邮箱 + 验密码 + 签发 session. 不区分"邮箱不存在"和"密码错"的错误,
// 防 username enumeration.
func (s *Service) Login(ctx context.Context, cmd LoginCommand) (*PublicUser, *SessionToken, error) {
	cmd.Email = strings.TrimSpace(cmd.Email)
	if cmd.Email == "" || cmd.Password == "" {
		return nil, nil, ErrBadCredentials
	}
	u, err := s.repo.FindByEmail(ctx, cmd.Email)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return nil, nil, ErrBadCredentials
		}
		return nil, nil, err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(cmd.Password)); err != nil {
		return nil, nil, ErrBadCredentials
	}
	tok, err := s.issueSession(ctx, u.ID)
	if err != nil {
		return nil, nil, err
	}
	return toPublic(u), tok, nil
}

// Logout 删除指定 session token. 没有就当 noop.
func (s *Service) Logout(ctx context.Context, token string) error {
	if token == "" {
		return nil
	}
	return s.repo.DeleteSession(ctx, token)
}

// ────── Me / Update ──────

// GetMe 返回当前用户视图.
func (s *Service) GetMe(ctx context.Context, userID uuid.UUID) (*PublicUser, error) {
	u, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return nil, err
	}
	return toPublic(u), nil
}

type UpdateMeCommand struct {
	DisplayName *string
	Bio         *string
	AvatarURL   *string
}

func (c *UpdateMeCommand) normalize() error {
	clamp := func(p **string, max int, name string) error {
		if *p == nil {
			return nil
		}
		v := strings.TrimSpace(**p)
		if utf8.RuneCountInString(v) > max {
			return fmt.Errorf("%w: %s too long", ErrInvalidInput, name)
		}
		*p = &v
		return nil
	}
	if err := clamp(&c.DisplayName, 60, "display_name"); err != nil {
		return err
	}
	if err := clamp(&c.Bio, 280, "bio"); err != nil {
		return err
	}
	if err := clamp(&c.AvatarURL, 500, "avatar_url"); err != nil {
		return err
	}
	return nil
}

// UpdateMe 部分更新 display_name/bio/avatar_url.
func (s *Service) UpdateMe(ctx context.Context, userID uuid.UUID, cmd UpdateMeCommand) (*PublicUser, error) {
	if err := cmd.normalize(); err != nil {
		return nil, err
	}
	u, err := s.repo.UpdateProfile(ctx, userID, UpdateProfileInput{
		DisplayName: cmd.DisplayName,
		Bio:         cmd.Bio,
		AvatarURL:   cmd.AvatarURL,
	})
	if err != nil {
		return nil, err
	}
	return toPublic(u), nil
}

// ChangePassword 验旧密码后改新密码, 然后吊销该用户所有 session.
// 不返回新 token — 客户端登出后用户重新登录, 否则别处的 session 也被吊销了.
func (s *Service) ChangePassword(ctx context.Context, userID uuid.UUID, oldPassword, newPassword string) error {
	if l := len(newPassword); l < MinPasswordLen || l > MaxPasswordLen {
		return fmt.Errorf("%w: password length must be %d..%d", ErrInvalidInput, MinPasswordLen, MaxPasswordLen)
	}
	u, err := s.repo.FindByID(ctx, userID)
	if err != nil {
		return err
	}
	if err := bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte(oldPassword)); err != nil {
		return ErrBadCredentials
	}
	newHash, err := hashPassword(newPassword)
	if err != nil {
		return fmt.Errorf("hash password: %w", err)
	}
	if err := s.repo.UpdatePasswordHash(ctx, userID, newHash); err != nil {
		return err
	}
	return s.repo.DeleteUserSessions(ctx, userID)
}

// LookupSession 暴露给 auth 中间件 — 通过 SessionLookup interface 调入.
// 返回 user_id 或 ErrSessionNotFound (含已过期).
func (s *Service) LookupSession(ctx context.Context, token string) (uuid.UUID, error) {
	sess, err := s.repo.LookupSession(ctx, token)
	if err != nil {
		return uuid.Nil, err
	}
	return sess.UserID, nil
}

// EnsureDevUser 在 dev bearer 模式下保证 DEV_USER_ID 对应 users 表有行,
// 这样 GET /v1/me 在用 dev token 时也能返回数据.
//
// placeholder password_hash 设为 '!' (一个不可能匹配 bcrypt 输出的占位),
// 让 dev user 不能用邮箱+密码登录 — 想登录就让人 UPDATE 改 hash.
func (s *Service) EnsureDevUser(ctx context.Context, id uuid.UUID, email string) error {
	if id == uuid.Nil {
		return nil
	}
	if email == "" {
		email = "dev@local"
	}
	return s.repo.EnsurePlaceholder(ctx, id, email)
}

// ────── helpers ──────

func (s *Service) issueSession(ctx context.Context, userID uuid.UUID) (*SessionToken, error) {
	tok, err := newSessionToken()
	if err != nil {
		return nil, err
	}
	exp := time.Now().Add(SessionTTL)
	if _, err := s.repo.CreateSession(ctx, tok, userID, exp); err != nil {
		return nil, err
	}
	return &SessionToken{Token: tok, ExpiresAt: exp}, nil
}

// newSessionToken 生成 32-byte URL-safe random token. base64.RawURLEncoding
// 不加 padding, 32 bytes → 43 char, 适合放在 Bearer header.
func newSessionToken() (string, error) {
	var b [32]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", fmt.Errorf("rand: %w", err)
	}
	return base64.RawURLEncoding.EncodeToString(b[:]), nil
}

func hashPassword(raw string) (string, error) {
	h, err := bcrypt.GenerateFromPassword([]byte(raw), bcrypt.DefaultCost)
	if err != nil {
		return "", err
	}
	return string(h), nil
}
