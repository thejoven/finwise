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
	// ErrInviteRequired 注册没带邀请码 (空).
	ErrInviteRequired = errors.New("invite code required")
	// ErrInviteInvalid 注册带的邀请码不可兑换 (无效/过期/用尽/已吊销).
	ErrInviteInvalid = errors.New("invite code invalid")
)

// InviteGate 是注册时校验+消费邀请码的依赖. 解耦目的同 auth 的 SessionLookup:
// account 不引 invite 包, 由 main.go 用闭包 (InviteGateFuncs) 注入实现.
//   - RedeemInvite: 原子消费一次; 不可兑换须返回 ErrInviteInvalid.
//   - RefundInvite: best-effort 退回 (注册后续失败时补偿), 失败可忽略.
type InviteGate interface {
	RedeemInvite(ctx context.Context, code string) error
	RefundInvite(ctx context.Context, code string) error
}

// InviteGateFuncs 把两个闭包适配成 InviteGate, 省掉 main.go 里单独定义适配类型.
type InviteGateFuncs struct {
	Redeem func(ctx context.Context, code string) error
	Refund func(ctx context.Context, code string) error
}

func (g InviteGateFuncs) RedeemInvite(ctx context.Context, code string) error {
	return g.Redeem(ctx, code)
}
func (g InviteGateFuncs) RefundInvite(ctx context.Context, code string) error {
	return g.Refund(ctx, code)
}

type Service struct {
	repo *Repository
	// invites 门禁注册的邀请码. nil 表示未配置 —— 此时 Register 一律拒绝 (fail closed).
	// cmd/admin 不走 Register (用 EnsureAdmin), 所以那边传 nil 无碍.
	invites InviteGate
}

func NewService(repo *Repository, invites InviteGate) *Service {
	return &Service{repo: repo, invites: invites}
}

// ────── DTO ──────

// PublicUser 是返回给客户端的 user 视图 — 不含 password_hash.
type PublicUser struct {
	ID          uuid.UUID
	Email       string
	DisplayName *string
	AvatarURL   *string
	Bio         *string
	IsAdmin     bool
	CreatedAt   time.Time
}

func toPublic(u *User) *PublicUser {
	return &PublicUser{
		ID:          u.ID,
		Email:       u.Email,
		DisplayName: u.DisplayName,
		AvatarURL:   u.AvatarURL,
		Bio:         u.Bio,
		IsAdmin:     u.IsAdmin,
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
	InviteCode  string
}

func (c *RegisterCommand) normalize() error {
	c.InviteCode = strings.TrimSpace(c.InviteCode)
	if c.InviteCode == "" {
		return ErrInviteRequired
	}
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
// 不验证邮箱 (产品决策: 邮箱注册不需要验证码), 但必须持有有效邀请码.
//
// 顺序: 先原子消费邀请码 (兼校验) → 再建用户 → 建失败则退回邀请码.
// 这样: 邀请码无效时不会建出用户; 邮箱重复 (建用户失败) 时不会白白烧掉一次邀请码额度.
// 消费走单条原子 UPDATE, 并发抢最后一次额度也只会有一个成功 (见 invite repo).
func (s *Service) Register(ctx context.Context, cmd RegisterCommand) (*PublicUser, *SessionToken, error) {
	if err := cmd.normalize(); err != nil {
		return nil, nil, err
	}
	// fail closed: 没配邀请码门禁就拒绝注册, 而不是放任无码注册.
	if s.invites == nil {
		return nil, nil, ErrInviteInvalid
	}
	hash, err := hashPassword(cmd.Password)
	if err != nil {
		return nil, nil, fmt.Errorf("hash password: %w", err)
	}
	// (1) 消费邀请码. 不可兑换 → ErrInviteInvalid, 不建用户.
	if err := s.invites.RedeemInvite(ctx, cmd.InviteCode); err != nil {
		return nil, nil, err
	}
	// (2) 建用户. 失败 (如邮箱重复) → 退回邀请码额度, 再把错误抛出去.
	u, err := s.repo.CreateUser(ctx, CreateUserInput{
		ID:           uuid.New(),
		Email:        cmd.Email,
		PasswordHash: hash,
		DisplayName:  cmd.DisplayName,
	})
	if err != nil {
		_ = s.invites.RefundInvite(ctx, cmd.InviteCode) // best-effort 补偿
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

// ────── admin ──────

// IsAdmin 暴露给 admin 中间件 — 通过 AdminChecker interface 调入.
// 返回该 user 是否管理员. 用户不存在返回 (false, nil) — 当成"非管理员"处理,
// 让中间件直接 403 而不是 500.
func (s *Service) IsAdmin(ctx context.Context, userID uuid.UUID) (bool, error) {
	ok, err := s.repo.IsAdmin(ctx, userID)
	if err != nil {
		if errors.Is(err, ErrNotFound) {
			return false, nil
		}
		return false, err
	}
	return ok, nil
}

// AdminUserView 是 admin 用户列表的一行视图 — 不含 password_hash.
type AdminUserView struct {
	ID          uuid.UUID
	Email       string
	DisplayName *string
	AvatarURL   *string
	Bio         *string
	IsAdmin     bool
	SignalCount int
	LastSeenAt  *time.Time
	CreatedAt   time.Time
}

// ListUsers 返回全部用户 (含活动指标), 给 admin "接入用户" 页用.
func (s *Service) ListUsers(ctx context.Context) ([]AdminUserView, error) {
	rows, err := s.repo.ListUsers(ctx)
	if err != nil {
		return nil, err
	}
	out := make([]AdminUserView, 0, len(rows))
	for _, r := range rows {
		out = append(out, AdminUserView{
			ID:          r.ID,
			Email:       r.Email,
			DisplayName: r.DisplayName,
			AvatarURL:   r.AvatarURL,
			Bio:         r.Bio,
			IsAdmin:     r.IsAdmin,
			SignalCount: r.SignalCount,
			LastSeenAt:  r.LastSeenAt,
			CreatedAt:   r.CreatedAt,
		})
	}
	return out, nil
}

// GetUser 是 admin 看任意用户详情 (区别于 self-scoped 的 GetMe). 找不到返回 ErrNotFound.
func (s *Service) GetUser(ctx context.Context, id uuid.UUID) (*PublicUser, error) {
	u, err := s.repo.FindByID(ctx, id)
	if err != nil {
		return nil, err
	}
	return toPublic(u), nil
}

// SetAdmin 按邮箱授予/收回管理员. 找不到用户返回 ErrNotFound.
// 给 admin "管理员管理" 接口和 grant-admin CLI 用.
func (s *Service) SetAdmin(ctx context.Context, email string, isAdmin bool) (*PublicUser, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, fmt.Errorf("%w: email required", ErrInvalidInput)
	}
	u, err := s.repo.SetAdminByEmail(ctx, email, isAdmin)
	if err != nil {
		return nil, err
	}
	return toPublic(u), nil
}

// EnsureAdmin 是引导第一个管理员用的: 邮箱不存在就用给定密码创建, 然后置 is_admin=true.
// 邮箱已存在则只翻 admin 标志 (不动密码 —— 不想覆盖人家自己设的). 返回 (用户, 是否新建).
// 给 scripts/grant-admin.sh 背后的 CLI 用.
func (s *Service) EnsureAdmin(ctx context.Context, email, password string) (*PublicUser, bool, error) {
	email = strings.TrimSpace(email)
	if email == "" {
		return nil, false, fmt.Errorf("%w: email required", ErrInvalidInput)
	}
	if _, err := mail.ParseAddress(email); err != nil {
		return nil, false, fmt.Errorf("%w: bad email", ErrInvalidInput)
	}

	existing, err := s.repo.FindByEmail(ctx, email)
	switch {
	case err == nil:
		// 已存在 — 只授予 admin, 不动密码.
		u, serr := s.repo.SetAdminByEmail(ctx, email, true)
		if serr != nil {
			return nil, false, serr
		}
		return toPublic(u), false, nil
	case errors.Is(err, ErrNotFound):
		// 不存在 — 用给定密码创建, 再授予 admin.
		if l := len(password); l < MinPasswordLen || l > MaxPasswordLen {
			return nil, false, fmt.Errorf("%w: 新建管理员需要密码, 长度 %d..%d", ErrInvalidInput, MinPasswordLen, MaxPasswordLen)
		}
		hash, herr := hashPassword(password)
		if herr != nil {
			return nil, false, fmt.Errorf("hash password: %w", herr)
		}
		if _, cerr := s.repo.CreateUser(ctx, CreateUserInput{
			ID:           uuid.New(),
			Email:        email,
			PasswordHash: hash,
		}); cerr != nil {
			return nil, false, cerr
		}
		u, serr := s.repo.SetAdminByEmail(ctx, email, true)
		if serr != nil {
			return nil, false, serr
		}
		return toPublic(u), true, nil
	default:
		_ = existing
		return nil, false, err
	}
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
