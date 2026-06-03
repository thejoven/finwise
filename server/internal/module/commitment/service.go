package commitment

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/google/uuid"

	"wiseflow/server/internal/domain"
)

var ErrInvalidInput = errors.New("invalid input")

type Service struct {
	repo *Repository
}

func NewService(repo *Repository) *Service {
	return &Service{repo: repo}
}

// ───── Draft (M7) ─────

type DraftCommand struct {
	UserID       uuid.UUID
	EvaluationID uuid.UUID
	Thesis       domain.Thesis
	Model        string
}

func (c *DraftCommand) Validate() error {
	if c.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if c.EvaluationID == uuid.Nil {
		return fmt.Errorf("%w: evaluation_id required", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Thesis.AssetTicker) == "" {
		return fmt.Errorf("%w: thesis.asset_ticker required", ErrInvalidInput)
	}
	if c.Thesis.PositionPct < 0 || c.Thesis.PositionPct > 100 {
		return fmt.Errorf("%w: position_pct out of [0, 100]", ErrInvalidInput)
	}
	if c.Thesis.DurationMonths < 1 || c.Thesis.DurationMonths > 36 {
		return fmt.Errorf("%w: duration_months out of [1, 36]", ErrInvalidInput)
	}
	if len(c.Thesis.ExitConditions) < 2 || len(c.Thesis.ExitConditions) > 4 {
		return fmt.Errorf("%w: exit_conditions must be 2..4", ErrInvalidInput)
	}
	if len(c.Thesis.ReasonsForFutureSelf) < 3 || len(c.Thesis.ReasonsForFutureSelf) > 5 {
		return fmt.Errorf("%w: reasons_for_future_self must be 3..5", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Model) == "" {
		return fmt.Errorf("%w: model required", ErrInvalidInput)
	}
	return nil
}

func (s *Service) RecordDraft(ctx context.Context, cmd DraftCommand) (*Commitment, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	return s.repo.InsertDraft(ctx, InsertDraftInput{
		UserID:       cmd.UserID,
		EvaluationID: cmd.EvaluationID,
		Thesis:       cmd.Thesis,
		Model:        cmd.Model,
	})
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Commitment, error) {
	return s.repo.GetByID(ctx, userID, id)
}

func (s *Service) LoadActive(ctx context.Context, userID uuid.UUID) (*Commitment, error) {
	return s.repo.LoadActive(ctx, userID)
}

// List 返回用户全部承诺 (新→旧). web-admin 列表用.
func (s *Service) List(ctx context.Context, userID uuid.UUID, limit int) ([]Commitment, error) {
	return s.repo.ListCommitments(ctx, userID, limit)
}

// GetByEvaluation 按 evaluation_id 查承诺 (信号链路用). 找不到返回 ErrNotFound.
func (s *Service) GetByEvaluation(ctx context.Context, userID, evalID uuid.UUID) (*Commitment, error) {
	return s.repo.GetByEvaluation(ctx, userID, evalID)
}

// ListHoldings 返回用户全部持仓 (新→旧, 带标的 ticker). web-admin 列表用.
func (s *Service) ListHoldings(ctx context.Context, userID uuid.UUID, limit int) ([]HoldingListItem, error) {
	return s.repo.ListHoldings(ctx, userID, limit)
}

// ───── Sign (M8) ─────

type SignCommand struct {
	UserID          uuid.UUID
	CommitmentID    uuid.UUID
	SigningClientID string
}

func (c *SignCommand) Validate() error {
	if c.UserID == uuid.Nil || c.CommitmentID == uuid.Nil {
		return fmt.Errorf("%w: ids required", ErrInvalidInput)
	}
	if strings.TrimSpace(c.SigningClientID) == "" {
		return fmt.Errorf("%w: signing_client_id required", ErrInvalidInput)
	}
	return nil
}

func (s *Service) Sign(ctx context.Context, cmd SignCommand) (*Commitment, *Holding, error) {
	if err := cmd.Validate(); err != nil {
		return nil, nil, err
	}
	return s.repo.Sign(ctx, SignInput{
		UserID:          cmd.UserID,
		CommitmentID:    cmd.CommitmentID,
		SigningClientID: cmd.SigningClientID,
	})
}

type PostponeCommand struct {
	UserID        uuid.UUID
	CommitmentID  uuid.UUID
	ClientEventID uuid.UUID
	Reason        *string
}

func (c *PostponeCommand) Validate() error {
	if c.UserID == uuid.Nil || c.CommitmentID == uuid.Nil {
		return fmt.Errorf("%w: ids required", ErrInvalidInput)
	}
	if c.ClientEventID == uuid.Nil {
		return fmt.Errorf("%w: client_event_id required", ErrInvalidInput)
	}
	return nil
}

func (s *Service) Postpone(ctx context.Context, cmd PostponeCommand) (*Commitment, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	return s.repo.Postpone(ctx, PostponeInput{
		UserID:        cmd.UserID,
		CommitmentID:  cmd.CommitmentID,
		ClientEventID: cmd.ClientEventID,
		Reason:        cmd.Reason,
	})
}

// ───── Holdings ─────

func (s *Service) LoadActiveHolding(ctx context.Context, userID uuid.UUID) (*Holding, error) {
	return s.repo.LoadActiveHolding(ctx, userID)
}

func (s *Service) GetHolding(ctx context.Context, userID, id uuid.UUID) (*Holding, error) {
	return s.repo.GetHolding(ctx, userID, id)
}
