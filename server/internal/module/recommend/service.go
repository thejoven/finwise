package recommend

import (
	"context"
	"fmt"

	"github.com/google/uuid"
	"go.uber.org/zap"
)

// Service 是 recommend 模块对外的应用层. P0 只暴露画像重算 (供内部端点手动触发);
// P1 起会在此挂上策展漏斗 + cron. builder 是其内部依赖.
type Service struct {
	repo    *Repository
	builder *Builder
	logger  *zap.Logger
}

func NewService(repo *Repository, logger *zap.Logger) *Service {
	return &Service{repo: repo, builder: NewBuilder(repo), logger: logger}
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
