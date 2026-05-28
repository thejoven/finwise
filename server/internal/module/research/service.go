package research

import (
	"context"
	"errors"
	"fmt"

	"github.com/google/uuid"
)

// ErrSessionNotFound — 拉一个不存在/不属于该 user 的 session research 时返回.
// research 自己不直接拿 session, 而是通过 main.go 传进来的 SessionLookup 闭包.
var ErrSessionNotFound = errors.New("refinement session not found")

// SessionLookup 是 main.go 传进来的跨模块查找闭包. 给定 (userID, sessionID),
// 返回 (primary_signal_id, found, err). 这样 research 包不直接 import refinement.
type SessionLookup func(ctx context.Context, userID, sessionID uuid.UUID) (uuid.UUID, bool, error)

type Service struct {
	repo          *Repository
	sessionLookup SessionLookup
}

func NewService(repo *Repository, lookup SessionLookup) *Service {
	return &Service{repo: repo, sessionLookup: lookup}
}

// SaveCommand 来自 /v1/internal/research POST.
type SaveCommand struct {
	UserID       uuid.UUID
	Scope        Scope
	SignalID     *uuid.UUID
	RefinementID *uuid.UUID
	Round        *int
	Query        string
	Results      []Result
	Model        string
}

func (s *Service) Save(ctx context.Context, cmd SaveCommand) (*Record, error) {
	return s.repo.Save(ctx, SaveInput{
		UserID:       cmd.UserID,
		Scope:        cmd.Scope,
		SignalID:     cmd.SignalID,
		RefinementID: cmd.RefinementID,
		Round:        cmd.Round,
		Query:        cmd.Query,
		Results:      cmd.Results,
		Model:        cmd.Model,
	})
}

// ListBySession 给 mobile 的"学习卡片" / "每题来源" 用. 校验 sessionID 属于 user.
func (s *Service) ListBySession(ctx context.Context, userID, sessionID uuid.UUID) ([]Record, error) {
	primarySignalID, ok, err := s.sessionLookup(ctx, userID, sessionID)
	if err != nil {
		return nil, fmt.Errorf("session lookup: %w", err)
	}
	if !ok {
		return nil, ErrSessionNotFound
	}
	return s.repo.ListBySession(ctx, userID, sessionID, primarySignalID)
}

func (s *Service) ListBySignal(ctx context.Context, userID, signalID uuid.UUID) ([]Record, error) {
	return s.repo.ListBySignal(ctx, userID, signalID)
}
