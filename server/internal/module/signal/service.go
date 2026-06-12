package signal

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"

	"wiseflow/server/internal/domain"
)

// ErrInvalidInput is the family of "user typed something we won't accept".
// Wrapped errors give the HTTP handler a 400 path.
var ErrInvalidInput = errors.New("invalid input")

// ErrInvalidProject — capture 时 project_id 不属于 user / 已归档. handler 转 400.
var ErrInvalidProject = errors.New("invalid project")

// ProjectOwnerCheck — 由 main.go 装配的闭包, capture 时校验 project_id 是否
// 属于该 user 且未归档. 返回 ErrInvalidProject 时上游转 400.
// 闭包形式避免 signal 模块反向 import project 模块.
type ProjectOwnerCheck func(ctx context.Context, userID, projectID uuid.UUID) error

// FirstActiveProjectFn — main.go 装配的闭包, 返回 user 第一个活跃分类 id (按 sort_order;
// 无分类返回 nil). RecordInference 在"信号未分类且 AI 弃权"时用它兜底, 保证信号有归属可见.
type FirstActiveProjectFn func(ctx context.Context, userID uuid.UUID) (*uuid.UUID, error)

// Service holds the business rules around signal capture / inference.
// Kept thin: repository is the work-horse.
type Service struct {
	repo         *Repository
	projectCheck ProjectOwnerCheck
	firstActive  FirstActiveProjectFn
}

// NewService — projectCheck / firstActive 可以传 nil (测试场景方便): projectCheck nil 时
// 跳过 project 归属校验; firstActive nil 时不做未分类兜底.
func NewService(repo *Repository, projectCheck ProjectOwnerCheck, firstActive FirstActiveProjectFn) *Service {
	return &Service{repo: repo, projectCheck: projectCheck, firstActive: firstActive}
}

// CaptureCommand is the API-facing input to capture a signal.
type CaptureCommand struct {
	UserID        uuid.UUID
	ClientEventID uuid.UUID
	ProjectID     *uuid.UUID // 可选; nil = 未分类
	// ProjectAutoAssigned: true = 系统临时归类 (promote 兜底), AI 推演可覆盖; false = 用户手选.
	ProjectAutoAssigned bool
	RawText             string
	OccurredAt          time.Time
}

// Validate enforces minimal sanity:
//   - raw_text non-empty and not pathological
//   - client_event_id present
//   - occurred_at not in the future by more than a small skew
func (c *CaptureCommand) Validate() error {
	trimmed := strings.TrimSpace(c.RawText)
	if trimmed == "" {
		return fmt.Errorf("%w: raw_text empty", ErrInvalidInput)
	}
	if utf8.RuneCountInString(trimmed) > 2000 {
		return fmt.Errorf("%w: raw_text exceeds 2000 chars", ErrInvalidInput)
	}
	if c.ClientEventID == uuid.Nil {
		return fmt.Errorf("%w: client_event_id required", ErrInvalidInput)
	}
	if c.OccurredAt.IsZero() {
		c.OccurredAt = time.Now().UTC()
	}
	// Reject obvious clock-skew (more than 10 min in the future).
	if c.OccurredAt.After(time.Now().Add(10 * time.Minute)) {
		return fmt.Errorf("%w: occurred_at too far in future", ErrInvalidInput)
	}
	c.RawText = trimmed
	return nil
}

// Capture runs the command. Returns the resulting signal + duplicate marker.
func (s *Service) Capture(ctx context.Context, cmd CaptureCommand) (*CaptureResult, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	// project_id 显式带入时, 校验属于 user 且未归档. 闭包未装配(测试场景)就跳过.
	if cmd.ProjectID != nil && s.projectCheck != nil {
		if err := s.projectCheck(ctx, cmd.UserID, *cmd.ProjectID); err != nil {
			return nil, err
		}
	}
	return s.repo.Capture(ctx, CaptureInput{
		UserID:              cmd.UserID,
		ClientEventID:       cmd.ClientEventID,
		ProjectID:           cmd.ProjectID,
		ProjectAutoAssigned: cmd.ProjectAutoAssigned,
		RawText:             cmd.RawText,
		CapturedAt:          cmd.OccurredAt,
	})
}

// ListFilter 是 List 的可选过滤. 加 q (search) 后参数太多, 收进 struct.
type ListFilter struct {
	Before     *time.Time
	Limit      int
	Query      string     // raw 用户输入; service 自己 trim. 空 = 不过滤.
	ProjectID  *uuid.UUID // nil = 全部 (不按分类过滤)
	HasTargets bool       // true → 只返回降噪后推演出相关标的的信号
}

// List returns the user's signals, newest first, paginated.
// Query 非空时做大小写无关的子串匹配 (raw_text + inference_summary).
func (s *Service) List(ctx context.Context, userID uuid.UUID, f ListFilter) ([]domain.Signal, bool, error) {
	q := strings.TrimSpace(f.Query)
	if utf8.RuneCountInString(q) > 200 {
		return nil, false, fmt.Errorf("%w: q too long", ErrInvalidInput)
	}
	return s.repo.List(ctx, ListInput{
		UserID:     userID,
		Before:     f.Before,
		Limit:      f.Limit,
		Query:      q,
		ProjectID:  f.ProjectID,
		HasTargets: f.HasTargets,
	})
}

// Get returns one signal.
func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*domain.Signal, error) {
	return s.repo.Get(ctx, userID, id)
}

// ErrInferenceDone 是 Reinfer 拒绝路径 — 已成功的 signal 不允许重推 (浪费 LLM).
var ErrInferenceDone = errors.New("inference already done; nothing to retry")

// Reinfer 由用户主动触发: 该 signal 卡在 pending (mastra LLM 概率性失败进 DLQ 了),
// 用户在 mobile 上点 "重试" → 这条路径.
//
// 实现: 不写新 event 行, 复用同一 source_event_id 在 outbox 上加一条同 subject
// 的待发布行. outbox worker pick up 后 publish, mastra 重新消费跑 analyst.
//
// 失败语义:
//   - signal 不属于 user → ErrNotFound (复用 repo.Get 过滤)
//   - 已 done → ErrInferenceDone (handler 转 409)
func (s *Service) Reinfer(ctx context.Context, userID, signalID uuid.UUID) (*domain.Signal, error) {
	sig, err := s.repo.Get(ctx, userID, signalID)
	if err != nil {
		return nil, err
	}
	if sig.InferenceStatus == domain.InferenceStatusDone {
		return nil, ErrInferenceDone
	}
	if err := s.repo.EnqueueReinferOutbox(ctx, sig); err != nil {
		return nil, fmt.Errorf("enqueue reinfer: %w", err)
	}
	return sig, nil
}

// InferenceCommand is the input to /v1/internal/inferences.
// SourceEventID is derived by the service from SignalID — callers (Mastra)
// don't have it and shouldn't have to look it up.
type InferenceCommand struct {
	SignalID      uuid.UUID
	UserID        uuid.UUID
	Summary       string
	Tags          []string
	Model         string
	RelatedAssets []domain.RelatedAsset
	Layer         *domain.CognitiveLayer
	Consensus     *domain.ConsensusCheck
	ProjectID     *uuid.UUID // AI 判断的分类 (可空 = 弃权); 经归属校验后参与 resolveInferenceProject.
}

func (c *InferenceCommand) Validate() error {
	if c.SignalID == uuid.Nil {
		return fmt.Errorf("%w: signal_id required", ErrInvalidInput)
	}
	if c.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Summary) == "" {
		return fmt.Errorf("%w: summary empty", ErrInvalidInput)
	}
	if utf8.RuneCountInString(c.Summary) > 200 {
		return fmt.Errorf("%w: summary too long", ErrInvalidInput)
	}
	if len(c.Tags) > 5 {
		return fmt.Errorf("%w: max 5 tags", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Model) == "" {
		return fmt.Errorf("%w: model required", ErrInvalidInput)
	}
	return nil
}

// RecordInference applies an analyst inference back into the system.
// Looks up source_event_id from the signal row so the caller doesn't have to
// know about events.id (an internal sequence we don't leak over the wire).
//
// 分类回写: AI 判断的 ProjectID 经归属校验 (非法当"弃权"丢弃, 绝不报错 —— 否则会 nak
// 整条推演浪费 analyst 结果), 再经 resolveInferenceProject 得最终分类写回 (见该函数注释).
func (s *Service) RecordInference(ctx context.Context, cmd InferenceCommand) error {
	if err := cmd.Validate(); err != nil {
		return err
	}
	sig, err := s.repo.Get(ctx, cmd.UserID, cmd.SignalID)
	if err != nil {
		return err
	}

	aiPID := cmd.ProjectID
	if aiPID != nil && s.projectCheck != nil {
		if err := s.projectCheck(ctx, cmd.UserID, *aiPID); err != nil {
			aiPID = nil // AI 给的分类不属于该 user / 已归档 → 当弃权, 走兜底
		}
	}
	// 信号仍未分类且 AI 弃权时, 落第一个活跃分类兜底 (与 useEnsureCategory 同序), 保证可见.
	var firstActive *uuid.UUID
	if sig.ProjectID == nil && aiPID == nil && s.firstActive != nil {
		if fp, ferr := s.firstActive(ctx, cmd.UserID); ferr == nil {
			firstActive = fp
		}
	}
	resolved := resolveInferenceProject(sig.ProjectID, sig.ProjectAutoAssigned, aiPID, firstActive)

	payload := domain.SignalInferenceDonePayload{
		SignalID:      cmd.SignalID,
		UserID:        cmd.UserID,
		Summary:       cmd.Summary,
		Tags:          cmd.Tags,
		Model:         cmd.Model,
		RelatedAssets: cmd.RelatedAssets,
		Layer:         cmd.Layer,
		Consensus:     cmd.Consensus,
		ProjectID:     resolved,
	}
	return s.repo.RecordInference(ctx, payload, sig.SourceEventID)
}

// resolveInferenceProject 决定推演回写后信号的最终分类. 纯函数, 无 DB 依赖, 便于 table-test.
//
//	existing     = 信号当前 project_id (nil = 未分类)
//	autoAssigned = 当前归属是否"系统临时归类"(promote 兜底); 仅 existing 非 nil 时有意义
//	aiChoice     = AI 判断的分类 (已校验归属; nil = AI 弃权/未判)
//	firstActive  = 兜底分类 (用户第一个活跃分类; nil = 用户无分类)
//
// 规则:
//   - 用户手选 (existing 非 nil 且 !autoAssigned) → 保留, AI 不覆盖.
//   - 系统临时归类 (existing 非 nil 且 autoAssigned) → AI 有合法判断则覆盖, 否则保留临时归属.
//   - 未分类 (existing nil) → AI 优先, 弃权则落 firstActive (用户无分类时仍可能 nil).
func resolveInferenceProject(existing *uuid.UUID, autoAssigned bool, aiChoice, firstActive *uuid.UUID) *uuid.UUID {
	if existing != nil {
		if autoAssigned && aiChoice != nil {
			return aiChoice
		}
		return existing
	}
	if aiChoice != nil {
		return aiChoice
	}
	return firstActive
}
