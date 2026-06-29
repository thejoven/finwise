package admin

import (
	"context"
	"math"

	"github.com/google/uuid"

	"alphax/server/internal/infra/objstore"
	"alphax/server/internal/module/settings"
)

type Service struct {
	repo *Repository
	// 对象存储后台配置依赖 (经 SetStorage 注入; 给 /v1/admin/settings/storage 用).
	settings *settings.Service
	storage  objstore.Storage
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// SetStorage 注入对象存储配置依赖 (settings + objstore). 装配期调用.
func (s *Service) SetStorage(settingsSvc *settings.Service, storage objstore.Storage) {
	s.settings = settingsSvc
	s.storage = storage
}

// OverviewView = 原始计数 + 派生的过会率 (0..1).
type OverviewView struct {
	Overview
	GatePassRate30d float64
}

func (s *Service) GetOverview(ctx context.Context) (*OverviewView, error) {
	o, err := s.repo.FetchOverview(ctx)
	if err != nil {
		return nil, err
	}
	return &OverviewView{
		Overview:        *o,
		GatePassRate30d: passRate(o.PipeGatePassed, o.PipeGateTotal),
	}, nil
}

// passRate 过会率, total=0 时返 0 (避免除零). 保留 3 位小数.
func passRate(passed, total int) float64 {
	if total <= 0 {
		return 0
	}
	return math.Round(float64(passed)/float64(total)*1000) / 1000
}

// InferenceHealthView 是 /v1/admin/inference/health 的视图.
// AvgLatencySeconds 无样本时为 0 (而非 null), 保留 2 位小数.
type InferenceHealthView struct {
	Pending           int
	Failed            int
	Done              int
	AvgLatencySeconds float64
	RecentFailures    []InferenceFailure
}

func (s *Service) GetInferenceHealth(ctx context.Context, failuresLimit int) (*InferenceHealthView, error) {
	h, err := s.repo.FetchInferenceHealth(ctx)
	if err != nil {
		return nil, err
	}
	failures, err := s.repo.ListRecentInferenceFailures(ctx, failuresLimit)
	if err != nil {
		return nil, err
	}
	avg := 0.0
	if h.AvgLatencySeconds != nil {
		avg = math.Round(*h.AvgLatencySeconds*100) / 100
	}
	return &InferenceHealthView{
		Pending:           h.Pending,
		Failed:            h.Failed,
		Done:              h.Done,
		AvgLatencySeconds: avg,
		RecentFailures:    failures,
	}, nil
}

func (s *Service) GetUserOverview(ctx context.Context, userID uuid.UUID) (*UserOverview, error) {
	return s.repo.FetchUserOverview(ctx, userID)
}
