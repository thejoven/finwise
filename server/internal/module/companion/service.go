package companion

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/infra/mastra"
)

var ErrInvalidInput = errors.New("invalid input")

type Service struct {
	repo   *Repository
	mastra *mastra.Client
	logger *zap.Logger
}

func NewService(repo *Repository, mc *mastra.Client, logger *zap.Logger) *Service {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Service{repo: repo, mastra: mc, logger: logger}
}

type OpenCommand struct {
	UserID        uuid.UUID
	CommitmentID  uuid.UUID
	ClientEventID uuid.UUID
	Origin        domain.CommitmentOpenOrigin
	OpenedAt      time.Time
}

func (c *OpenCommand) Validate() error {
	if c.UserID == uuid.Nil || c.CommitmentID == uuid.Nil {
		return fmt.Errorf("%w: ids required", ErrInvalidInput)
	}
	if c.ClientEventID == uuid.Nil {
		return fmt.Errorf("%w: client_event_id required", ErrInvalidInput)
	}
	switch c.Origin {
	case domain.OpenOriginDeeplink, domain.OpenOriginTab, domain.OpenOriginTriggerCard:
		// ok
	case "":
		c.Origin = domain.OpenOriginTab
	default:
		return fmt.Errorf("%w: unknown origin", ErrInvalidInput)
	}
	return nil
}

// RecordOpen: 两段式.
//   1. 快速 tx: 记录 open event + 累加 fingerprint, 看是否到 anxiety 阈值
//   2. 若到阈值: 调 Mastra Editor (15s 超时), 失败 fallback 随机 reason; 然后单独 tx
//      写 companion.shown event + 标 fingerprint.companion_shown=true
func (s *Service) RecordOpen(ctx context.Context, cmd OpenCommand) (*OpenResult, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	result, err := s.repo.RecordOpen(ctx, OpenInput{
		UserID:        cmd.UserID,
		CommitmentID:  cmd.CommitmentID,
		ClientEventID: cmd.ClientEventID,
		Origin:        cmd.Origin,
		OpenedAt:      cmd.OpenedAt,
	})
	if err != nil {
		return nil, err
	}
	if !result.ShouldShowCompanion {
		return result, nil
	}

	// 决定 reason kind
	reason := domain.CompanionAnxiety3x
	if result.OpensToday >= 5 {
		reason = domain.CompanionAnxiety5x
	}

	// 尝试 Mastra Editor; 失败 fallback
	editorText, editorModel := s.runEditorWithFallback(ctx, cmd.UserID, cmd.CommitmentID, result.OpensToday, result.ReasonsForFutureSelf)

	view, emitErr := s.repo.EmitCompanion(ctx, EmitCompanionInput{
		UserID:        cmd.UserID,
		CommitmentID:  cmd.CommitmentID,
		FingerprintID: result.FingerprintID,
		Reason:        reason,
		EditorText:    editorText,
		EditorModel:   editorModel,
	})
	if emitErr != nil {
		// companion 写失败不阻塞 — 用户已经收到了 should_show=true, 下次 GET /companion 还会
		// 重新尝试. 这里 log + 返回 result without view.
		s.logger.Warn("emit companion failed",
			zap.String("commitment_id", cmd.CommitmentID.String()),
			zap.Error(emitErr),
		)
		return result, nil
	}
	result.CompanionView = view
	return result, nil
}

// runEditorWithFallback: 优先 Mastra Editor, 任何失败 fallback 到随机 reason 引用.
// 调用方需要确保 reasons 非空 (caller 已经在 ShouldShowCompanion=true 路径).
func (s *Service) runEditorWithFallback(ctx context.Context, userID, commitID uuid.UUID, opens int, reasons []string) (string, string) {
	if !s.mastra.IsConfigured() {
		text, model := FallbackEditorText(reasons)
		return text, model
	}
	assetName, _ := s.repo.LoadCommitmentAssetName(ctx, commitID)
	if assetName == "" {
		assetName = "(unknown)"
	}
	callCtx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	resp, err := s.mastra.Editor(callCtx, mastra.EditorRequest{
		UserID:               userID.String(),
		AssetName:            assetName,
		OpensToday:           opens,
		ReasonsForFutureSelf: reasons,
	})
	if err != nil {
		s.logger.Warn("mastra editor failed, fallback",
			zap.String("commitment_id", commitID.String()),
			zap.Error(err),
		)
		text, model := FallbackEditorText(reasons)
		return text, model
	}
	return resp.EditorText, "mastra-editor"
}

func (s *Service) GetCompanionToday(ctx context.Context, userID, commitID uuid.UUID) (*CompanionView, error) {
	return s.repo.GetCompanionToday(ctx, userID, commitID)
}
