package recommend

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Service 是 recommend 模块对外的应用层. P0 暴露画像重算; P1 起加策展(curator)+呈现/反馈.
// builder(画像) 与 curator(策展漏斗) 是其内部依赖.
type Service struct {
	repo    *Repository
	builder *Builder
	curator *Curator
	logger  *zap.Logger
}

func NewService(repo *Repository, cfg CuratorConfig, logger *zap.Logger) *Service {
	return &Service{
		repo:    repo,
		builder: NewBuilder(repo),
		curator: NewCurator(repo, cfg, logger),
		logger:  logger,
	}
}

// RebuildUser 重算并落库单个用户的画像, 返回新画像 (供端点回显人工核对).
func (s *Service) RebuildUser(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	p, err := s.builder.BuildProfile(ctx, userID)
	if err != nil {
		return nil, fmt.Errorf("build profile %s: %w", userID, err)
	}
	if err := s.repo.UpsertProfile(ctx, p); err != nil {
		return nil, fmt.Errorf("upsert profile %s: %w", userID, err)
	}
	return p, nil
}

// RebuildAllResult — 全量重算的汇总 (端点回显).
type RebuildAllResult struct {
	Total      int          `json:"total"`
	Succeeded  int          `json:"succeeded"`
	Failed     int          `json:"failed"`
	FailedUser []failedUser `json:"failed_users,omitempty"`
}

type failedUser struct {
	UserID string `json:"user_id"`
	Error  string `json:"error"`
}

// RebuildAll 对所有有行为的用户逐个重算. best-effort: 单个用户失败记日志并继续,
// 不让一条坏数据拖垮整批 (与 subscription poller 的容错同调).
func (s *Service) RebuildAll(ctx context.Context) (*RebuildAllResult, error) {
	users, err := s.repo.ListUserIDsWithBehavior(ctx)
	if err != nil {
		return nil, fmt.Errorf("list users: %w", err)
	}
	res := &RebuildAllResult{Total: len(users)}
	for _, uid := range users {
		if err := ctx.Err(); err != nil {
			return res, err
		}
		if _, err := s.RebuildUser(ctx, uid); err != nil {
			res.Failed++
			s.logger.Warn("rebuild profile failed (skipped)",
				zap.String("user_id", uid.String()), zap.Error(err))
			if len(res.FailedUser) < 20 { // 防回包过大, 只回前 20 条
				res.FailedUser = append(res.FailedUser, failedUser{UserID: uid.String(), Error: err.Error()})
			}
			continue
		}
		res.Succeeded++
	}
	s.logger.Info("rebuild all profiles done",
		zap.Int("total", res.Total), zap.Int("succeeded", res.Succeeded), zap.Int("failed", res.Failed))
	return res, nil
}

// ───────────────────────── P1 · 策展 + 呈现/反馈 ─────────────────────────

// CurateUser 对单用户跑策展漏斗 (供内部端点 / 画像重算后增量触发).
func (s *Service) CurateUser(ctx context.Context, userID uuid.UUID) (CurateResult, error) {
	return s.curator.CurateForUser(ctx, userID)
}

// CurateAll 全量策展 (有活跃命题的用户).
func (s *Service) CurateAll(ctx context.Context) (CurateAllResult, error) {
	return s.curator.CurateAll(ctx)
}

// RelatedForCommitment 取某命题的相关情报. user-scoped: 只回该 user 自己 commitment 的推荐;
// 非本人/不存在的 commitmentID 自然返回空 —— 不泄漏, 无需单独 owner 校验.
func (s *Service) RelatedForCommitment(ctx context.Context, userID, commitmentID uuid.UUID) ([]RelatedItem, error) {
	return s.repo.ListCommitmentRelated(ctx, userID, commitmentID)
}

// Dismiss 用户点"不相关": 负反馈, 该条不再复现 (候选 NOT EXISTS 已排除已推过的).
func (s *Service) Dismiss(ctx context.Context, userID, recID uuid.UUID) error {
	return s.repo.MarkRecommendationStatus(ctx, userID, recID, StatusDismissed)
}

// Seen 标记已呈现 (展开即调).
func (s *Service) Seen(ctx context.Context, userID, recID uuid.UUID) error {
	return s.repo.MarkRecommendationStatus(ctx, userID, recID, StatusSurfaced)
}
