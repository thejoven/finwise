package attention

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
)

var ErrInvalidInput = errors.New("invalid input")

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// ───── Upsert (internal, mastra 调) ─────

func (c *UpsertInput) Validate() error {
	if c.RefinementID == uuid.Nil {
		return fmt.Errorf("%w: refinement_id required", ErrInvalidInput)
	}
	if c.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	for name, val := range map[string]int{
		"focus_score":     c.FocusScore,
		"depth_score":     c.DepthScore,
		"breadth_score":   c.BreadthScore,
		"execution_score": c.ExecutionScore,
	} {
		if val < 0 || val > 100 {
			return fmt.Errorf("%w: %s out of range 0-100", ErrInvalidInput, name)
		}
	}
	if strings.TrimSpace(c.Insight) == "" {
		return fmt.Errorf("%w: insight empty", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Blindspot) == "" {
		return fmt.Errorf("%w: blindspot empty", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Model) == "" {
		return fmt.Errorf("%w: model required", ErrInvalidInput)
	}
	return nil
}

func (s *Service) Upsert(ctx context.Context, in UpsertInput) (*Summary, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	return s.repo.Upsert(ctx, in)
}

// ───── User-facing aggregate ─────

// SummaryView — 给 mobile GET /v1/attention/summary 用.
type SummaryView struct {
	Window               string         // "30d" / "all"
	TotalCompleted       int            // 完成总次数
	LatestSummaries      []Summary      // 最近 N 条 attention record (含 LLM insight)
	AverageFocusScore    int            // 4 维平均, 用户看一眼整体水平
	AverageDepthScore    int
	AverageBreadthScore  int
	AverageExecutionScore int
	TopTags              []TagFreq      // 信号领域分布
}

// GetSummary — 拉用户 N 天内的 attention 聚合视图.
// window 解析: "7d" / "30d" / "all" (默认 30d).
// projectID 非空时通过 JOIN signals.project_id 过滤, 只看该分类下的统计.
func (s *Service) GetSummary(ctx context.Context, userID uuid.UUID, window string, projectID *uuid.UUID) (*SummaryView, error) {
	var since *time.Time
	switch strings.TrimSpace(window) {
	case "", "30d":
		t := time.Now().AddDate(0, 0, -30)
		since = &t
		window = "30d"
	case "7d":
		t := time.Now().AddDate(0, 0, -7)
		since = &t
	case "all":
		since = nil
	default:
		return nil, fmt.Errorf("%w: unsupported window (use 7d/30d/all)", ErrInvalidInput)
	}

	const recentLimit = 10
	const topTagsLimit = 8

	list, err := s.repo.ListByUser(ctx, userID, since, projectID, recentLimit)
	if err != nil {
		return nil, err
	}
	total, err := s.repo.CountCompletedRefinements(ctx, userID, since, projectID)
	if err != nil {
		return nil, err
	}
	tags, err := s.repo.TopTagsByUser(ctx, userID, since, projectID, topTagsLimit)
	if err != nil {
		return nil, err
	}

	view := SummaryView{
		Window:          window,
		TotalCompleted:  total,
		LatestSummaries: list,
		TopTags:         tags,
	}

	// 4 维平均 — 用 LatestSummaries (不是全量, 但够代表近况)
	if n := len(list); n > 0 {
		var f, d, b, e int
		for _, r := range list {
			f += r.FocusScore
			d += r.DepthScore
			b += r.BreadthScore
			e += r.ExecutionScore
		}
		view.AverageFocusScore = f / n
		view.AverageDepthScore = d / n
		view.AverageBreadthScore = b / n
		view.AverageExecutionScore = e / n
	}
	return &view, nil
}
