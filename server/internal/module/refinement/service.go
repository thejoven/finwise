package refinement

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"flashfi/server/internal/domain"
)

var (
	ErrInvalidInput    = errors.New("invalid input")
	ErrSignalNotOwned  = errors.New("primary_signal_id not owned by user")
)

// SignalOwnerCheck — 检查 signal 是否属于 user.
// 返回 nil = 属于; 非 nil error = 不属于或查询失败.
//
// 注入方式: 闭包绑 signal.Service.Get (返 ErrNotFound 即不属于).
// 用 closure 避免 refinement → signal 反向 import — 与 research 模块一致.
type SignalOwnerCheck func(ctx context.Context, userID, signalID uuid.UUID) error

type Service struct {
	repo             *Repository
	signalOwnerCheck SignalOwnerCheck
}

// NewService — signalOwnerCheck 必填, 用于 Start 前的 ownership 校验.
// nil 等于"任何 signal_id 都接受", 仅供 test 用 — 不要在生产 wire nil.
func NewService(repo *Repository, signalOwnerCheck SignalOwnerCheck) *Service {
	return &Service{repo: repo, signalOwnerCheck: signalOwnerCheck}
}

// ───── Start ─────

type StartCommand struct {
	UserID          uuid.UUID
	ClientEventID   uuid.UUID
	PrimarySignalID uuid.UUID
	PrimaryAsset    *string
}

func (c *StartCommand) Validate() error {
	if c.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if c.ClientEventID == uuid.Nil {
		return fmt.Errorf("%w: client_event_id required", ErrInvalidInput)
	}
	if c.PrimarySignalID == uuid.Nil {
		return fmt.Errorf("%w: primary_signal_id required", ErrInvalidInput)
	}
	if c.PrimaryAsset != nil {
		ticker := strings.TrimSpace(*c.PrimaryAsset)
		if ticker == "" {
			c.PrimaryAsset = nil
		} else {
			c.PrimaryAsset = &ticker
		}
	}
	return nil
}

func (s *Service) Start(ctx context.Context, cmd StartCommand) (*Session, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	// Ownership 校验: 防止用户在不属于自己的 signal 上开 refinement.
	// (signal.repo.Get 是 user-filtered, 这里依赖它返 ErrNotFound 表示不属于.)
	if s.signalOwnerCheck != nil {
		if err := s.signalOwnerCheck(ctx, cmd.UserID, cmd.PrimarySignalID); err != nil {
			return nil, fmt.Errorf("%w: %v", ErrSignalNotOwned, err)
		}
	}
	sessionID := uuid.New()
	return s.repo.Start(ctx, StartInput{
		UserID:          cmd.UserID,
		ClientEventID:   cmd.ClientEventID,
		SessionID:       sessionID,
		PrimarySignalID: cmd.PrimarySignalID,
		PrimaryAsset:    cmd.PrimaryAsset,
	})
}

// ───── ReinferQuestion ─────
// 用户主动触发: 等下一题卡很久 (上一条 refinement.answered 被 mastra socratic DLQ).
// 重发同一条 event 让 mastra 重出当前轮.

var (
	ErrAlreadyCompleted   = errors.New("session already completed")
	ErrHasPendingQuestion = errors.New("session has a pending question; no need to retry")
	ErrNotStarted         = errors.New("session has no answered round yet; cannot retry question")
)

func (s *Service) ReinferQuestion(ctx context.Context, userID, sessionID uuid.UUID) error {
	view, err := s.repo.Get(ctx, userID, sessionID)
	if err != nil {
		return err
	}
	if view.Status != "active" {
		return ErrAlreadyCompleted
	}
	// 已经有 pending question (mastra 已出题, 等用户答) → 没必要重推
	if view.Question != nil {
		return ErrHasPendingQuestion
	}
	// 一轮都没答过 → 出 R1 走的是 refinement.started, 这条路径不适用. v1 不支持.
	if view.RoundsDone == 0 {
		return ErrNotStarted
	}
	return s.repo.EnqueueReinferQuestionOutbox(ctx, sessionID)
}

// ───── Get ─────

func (s *Service) Get(ctx context.Context, userID, sessionID uuid.UUID) (*SessionView, error) {
	return s.repo.Get(ctx, userID, sessionID)
}

// GetLatestCompletedBySignal — 信号详情页用, 拉该信号上最近一次完成的五轮追问.
func (s *Service) GetLatestCompletedBySignal(ctx context.Context, userID, signalID uuid.UUID) (*SessionView, error) {
	if userID == uuid.Nil {
		return nil, fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if signalID == uuid.Nil {
		return nil, fmt.Errorf("%w: signal_id required", ErrInvalidInput)
	}
	return s.repo.GetLatestCompletedBySignal(ctx, userID, signalID)
}

// ───── Answer ─────

type AnswerCommand struct {
	UserID        uuid.UUID
	ClientEventID uuid.UUID
	SessionID     uuid.UUID
	Round         int
	QuestionID    string
	QuestionKind  domain.QuestionKind
	QuestionText  string
	Options       []domain.QuestionOption
	Answer        domain.UserAnswer
	Diagnosis     domain.AnswerDiagnosis
}

func (c *AnswerCommand) Validate() error {
	if c.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if c.ClientEventID == uuid.Nil {
		return fmt.Errorf("%w: client_event_id required", ErrInvalidInput)
	}
	if c.SessionID == uuid.Nil {
		return fmt.Errorf("%w: session_id required", ErrInvalidInput)
	}
	if c.Round < 1 || c.Round > 5 {
		return fmt.Errorf("%w: round must be 1..5", ErrInvalidInput)
	}
	if strings.TrimSpace(c.QuestionID) == "" {
		return fmt.Errorf("%w: question_id required", ErrInvalidInput)
	}
	if c.QuestionKind == "" {
		return fmt.Errorf("%w: question_kind required", ErrInvalidInput)
	}
	if strings.TrimSpace(c.QuestionText) == "" {
		return fmt.Errorf("%w: question_text required", ErrInvalidInput)
	}
	if c.Diagnosis.Kind == "" {
		return fmt.Errorf("%w: diagnosis.kind required", ErrInvalidInput)
	}
	return nil
}

func (s *Service) Answer(ctx context.Context, cmd AnswerCommand) (*AnswerResult, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	return s.repo.RecordAnswer(ctx, AnswerInput{
		UserID:        cmd.UserID,
		ClientEventID: cmd.ClientEventID,
		SessionID:     cmd.SessionID,
		Round:         cmd.Round,
		QuestionID:    cmd.QuestionID,
		QuestionKind:  cmd.QuestionKind,
		QuestionText:  cmd.QuestionText,
		Options:       cmd.Options,
		Answer:        cmd.Answer,
		Diagnosis:     cmd.Diagnosis,
	})
}

// ───── SaveQuestion (internal) ─────

type SaveQuestionCommand struct {
	UserID    uuid.UUID
	SessionID uuid.UUID
	Round     int
	Payload   []byte
}

func (c *SaveQuestionCommand) Validate() error {
	if c.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if c.SessionID == uuid.Nil {
		return fmt.Errorf("%w: session_id required", ErrInvalidInput)
	}
	if c.Round < 1 || c.Round > 5 {
		return fmt.Errorf("%w: round must be 1..5", ErrInvalidInput)
	}
	if len(c.Payload) == 0 {
		return fmt.Errorf("%w: payload empty", ErrInvalidInput)
	}
	return nil
}

func (s *Service) SaveQuestion(ctx context.Context, cmd SaveQuestionCommand) error {
	if err := cmd.Validate(); err != nil {
		return err
	}
	return s.repo.SaveQuestion(ctx, SaveQuestionInput{
		UserID:    cmd.UserID,
		SessionID: cmd.SessionID,
		Round:     cmd.Round,
		Payload:   cmd.Payload,
	})
}
