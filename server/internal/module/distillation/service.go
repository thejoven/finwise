package distillation

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

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

func (in *UpsertInput) Validate() error {
	if in.RefinementID == uuid.Nil {
		return fmt.Errorf("%w: refinement_id required", ErrInvalidInput)
	}
	if in.UserID == uuid.Nil {
		return fmt.Errorf("%w: user_id required", ErrInvalidInput)
	}
	if strings.TrimSpace(in.Model) == "" {
		return fmt.Errorf("%w: model required", ErrInvalidInput)
	}
	// 至少带一项内容 — 否则这次 POST 什么都没更新, 没意义.
	if in.DistilledContent == nil && in.Beneficiary == nil {
		return fmt.Errorf("%w: nothing to upsert (need distilled_content or beneficiary)", ErrInvalidInput)
	}
	// beneficiary 若给了, 必须是合法 JSON 数组 (沉默用 "[]").
	if in.Beneficiary != nil {
		if !json.Valid(in.Beneficiary) {
			return fmt.Errorf("%w: beneficiary not valid json", ErrInvalidInput)
		}
		var arr []json.RawMessage
		if err := json.Unmarshal(in.Beneficiary, &arr); err != nil {
			return fmt.Errorf("%w: beneficiary must be a json array", ErrInvalidInput)
		}
	}
	return nil
}

func (s *Service) Upsert(ctx context.Context, in UpsertInput) (*Distillation, error) {
	if err := in.Validate(); err != nil {
		return nil, err
	}
	return s.repo.Upsert(ctx, in)
}

// ───── Get (降噪页读) ─────

func (s *Service) Get(ctx context.Context, userID, refinementID uuid.UUID) (*Distillation, error) {
	return s.repo.GetByRefinement(ctx, userID, refinementID)
}
