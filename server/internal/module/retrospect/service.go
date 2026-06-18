package retrospect

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"alphax/server/internal/domain"
	"alphax/server/internal/infra/db"
	"alphax/server/internal/infra/mastra"
)

var ErrInvalidInput = errors.New("invalid input")

type Service struct {
	repo   *Repository
	pool   *db.Pool // 拉 commitment thesis 给 Mastra Diagnostician 提供 context
	mastra *mastra.Client
	logger *zap.Logger
}

func NewService(repo *Repository, pool *db.Pool, mc *mastra.Client, logger *zap.Logger) *Service {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Service{repo: repo, pool: pool, mastra: mc, logger: logger}
}

func (s *Service) Start(ctx context.Context, userID, commitmentID uuid.UUID, trigger domain.RetrospectTrigger) (*Retrospect, error) {
	if userID == uuid.Nil || commitmentID == uuid.Nil {
		return nil, fmt.Errorf("%w: ids required", ErrInvalidInput)
	}
	switch trigger {
	case domain.RetrospectTriggerExpired, domain.RetrospectTriggerClosed, domain.RetrospectTriggerManual:
	case "":
		trigger = domain.RetrospectTriggerManual
	default:
		return nil, fmt.Errorf("%w: unknown trigger", ErrInvalidInput)
	}
	return s.repo.Start(ctx, StartInput{
		UserID:       userID,
		CommitmentID: commitmentID,
		Trigger:      trigger,
	})
}

type AnswerCommand struct {
	UserID        uuid.UUID
	RetrospectID  uuid.UUID
	ClientEventID uuid.UUID
	QuestionNo    int
	Dim           domain.RetrospectDimension
	Choice        string
	OpenText      *string
}

func (c *AnswerCommand) Validate() error {
	if c.QuestionNo < 1 || c.QuestionNo > 4 {
		return fmt.Errorf("%w: question_no 1..4", ErrInvalidInput)
	}
	switch c.Dim {
	case domain.DimPerception, domain.DimInference, domain.DimEvaluation, domain.DimExecution:
	default:
		return fmt.Errorf("%w: unknown dim", ErrInvalidInput)
	}
	if strings.TrimSpace(c.Choice) == "" {
		return fmt.Errorf("%w: choice required", ErrInvalidInput)
	}
	if c.ClientEventID == uuid.Nil {
		return fmt.Errorf("%w: client_event_id required", ErrInvalidInput)
	}
	return nil
}

func (s *Service) Answer(ctx context.Context, cmd AnswerCommand) (*Retrospect, error) {
	if err := cmd.Validate(); err != nil {
		return nil, err
	}
	return s.repo.RecordAnswer(ctx, AnswerInput{
		UserID:        cmd.UserID,
		RetrospectID:  cmd.RetrospectID,
		ClientEventID: cmd.ClientEventID,
		QuestionNo:    cmd.QuestionNo,
		Dim:           cmd.Dim,
		Choice:        cmd.Choice,
		OpenText:      cmd.OpenText,
	})
}

// Finalize 收集 4 个答案后调. 走 Mastra Diagnostician, 失败 fallback 启发式.
func (s *Service) Finalize(ctx context.Context, userID, retrospectID uuid.UUID) (*Retrospect, error) {
	retro, err := s.repo.Get(ctx, userID, retrospectID)
	if err != nil {
		return nil, err
	}
	if retro.State == "finalized" {
		return nil, ErrAlreadyFinalized
	}
	if len(retro.Answers) < 4 {
		return nil, fmt.Errorf("%w: need 4 answers, have %d", ErrInvalidState, len(retro.Answers))
	}

	focusDim, focusText, model := s.runDiagnosticianWithFallback(ctx, retro)

	return s.repo.Finalize(ctx, FinalizeInput{
		UserID:             userID,
		RetrospectID:       retrospectID,
		FocusDim:           focusDim,
		FocusText:          focusText,
		DiagnosticianModel: model,
	})
}

// runDiagnosticianWithFallback 优先 Mastra; 失败 fallback 启发式. 不阻塞用户.
func (s *Service) runDiagnosticianWithFallback(ctx context.Context, retro *Retrospect) (domain.FocusDim, string, string) {
	heuristicDim, heuristicText := heuristicFocus(retro.Answers)

	if !s.mastra.IsConfigured() {
		return heuristicDim, heuristicText, "heuristic-v1"
	}

	asset, summary := s.loadCommitmentBrief(ctx, retro.CommitmentID)
	mastraAns := make([]mastra.DiagnosticianAnswer, 0, len(retro.Answers))
	for _, a := range retro.Answers {
		dimName := string(a.Dim)
		question := questionTextForDim(a.Q, dimName)
		openText := ""
		if a.OpenText != nil {
			openText = *a.OpenText
		}
		mastraAns = append(mastraAns, mastra.DiagnosticianAnswer{
			No:       a.Q,
			Dim:      dimName,
			Question: question,
			Choice:   a.Choice,
			OpenText: openText,
		})
	}

	callCtx, cancel := context.WithTimeout(ctx, 25*time.Second)
	defer cancel()
	resp, err := s.mastra.Diagnostician(callCtx, mastra.DiagnosticianRequest{
		Language:                db.UserLanguage(ctx, s.pool, retro.UserID),
		UserID:                  retro.UserID.String(),
		CommitmentAsset:         asset,
		CommitmentThesisSummary: summary,
		Answers:                 mastraAns,
	})
	if err != nil {
		s.logger.Warn("diagnostician failed, fallback to heuristic",
			zap.String("retrospect_id", retro.ID.String()),
			zap.Error(err),
		)
		return heuristicDim, heuristicText, "heuristic-v1-after-mastra-fail"
	}

	// Mastra 返回的 focus_dim 必须是已知 6 个之一; 否则回退启发式
	dim := domain.FocusDim(resp.FocusDim)
	if !isValidFocusDim(dim) {
		s.logger.Warn("diagnostician returned invalid focus_dim, fallback",
			zap.String("got", resp.FocusDim),
		)
		return heuristicDim, heuristicText, "heuristic-v1-invalid-dim"
	}
	return dim, resp.FocusText, "mastra-diagnostician"
}

func isValidFocusDim(d domain.FocusDim) bool {
	switch d {
	case domain.FocusPerceptionSpeed, domain.FocusInferenceDepth, domain.FocusDecisionSpeed,
		domain.FocusHoldingPatience, domain.FocusExitQuality, domain.FocusThesisEvolution:
		return true
	}
	return false
}

// loadCommitmentBrief 拉 asset_name + 简短 summary, 给 Diagnostician 上下文.
func (s *Service) loadCommitmentBrief(ctx context.Context, commitID uuid.UUID) (asset, summary string) {
	const q = `SELECT thesis FROM commitments WHERE id = $1`
	var raw []byte
	if err := s.pool.QueryRow(ctx, q, commitID).Scan(&raw); err != nil {
		return "(unknown)", "(unknown)"
	}
	var t domain.Thesis
	if err := json.Unmarshal(raw, &t); err != nil {
		return "(unknown)", "(unknown)"
	}
	asset = t.AssetName
	if asset == "" {
		asset = t.AssetTicker
	}
	parts := []string{
		fmt.Sprintf("action=%s position=%.0f%% duration=%dmo", t.Action, t.PositionPct, t.DurationMonths),
	}
	if len(t.ReasonsForFutureSelf) > 0 {
		parts = append(parts, "reason: "+t.ReasonsForFutureSelf[0])
	}
	summary = strings.Join(parts, " · ")
	return
}

// questionTextForDim 简单映射用 — Mastra 不需要看到精确题目文案, 只要知道是哪个维度.
// v2 客户端把 question_text 也持久化, 这里从 events 拉.
// 与 mobile/src/features/retrospect/questions.ts 的题面保持同步 (AlphaX Pro Lens 词汇).
func questionTextForDim(no int, dim string) string {
	switch dim {
	case "perception":
		return "录入这条信号时, 它在叙事生命周期的哪一段?"
	case "inference":
		return "推演链跑到第几跳? 用了哪几个 lens?"
	case "evaluation":
		return "退出条件能把这个仓位的'凸性'还原成现金吗?"
	case "execution":
		return "从签字到行动, 犹豫成本来自哪里?"
	}
	return fmt.Sprintf("Q%d (%s)", no, dim)
}

// heuristicFocus 简单启发: 找 open_text 最短/空的那一题, 映射到 focus_dim.
// v2 (Mastra Diagnostician) 跑真 LLM 替换.
// 文案锚定 AlphaX Pro Lens — 不写抽象词, 不出现人名, 给到下一次可执行的动作.
func heuristicFocus(answers []AnswerEntry) (domain.FocusDim, string) {
	var weakest *AnswerEntry
	minLen := 999_999
	for i := range answers {
		a := &answers[i]
		l := 0
		if a.OpenText != nil {
			l = len(strings.TrimSpace(*a.OpenText))
		}
		if l < minLen {
			minLen = l
			weakest = a
		}
	}
	if weakest == nil {
		return domain.FocusInferenceDepth,
			"下一次, 推演链至少跑到第三跳, 并用 2 个以上学科 lens (法律 / 工程 / 博弈 / 历史) 交叉看一遍."
	}
	switch weakest.Dim {
	case domain.DimPerception:
		return domain.FocusPerceptionSpeed,
			"下一次, 在叙事还处在沉默 / 圈内早期时就把信号录进来; 不要等它进入 sell-side 报告或主流头条 — 那时已是晚期共识."
	case domain.DimInference:
		return domain.FocusInferenceDepth,
			"下一次, 把推演链跑到第三跳, 并用至少 3 个学科 lens (心理 / 法律 / 历史 / 博弈 / 生物 / 工程 中挑) 交叉看一遍; 不要只用金融 + 商业."
	case domain.DimEvaluation:
		return domain.FocusExitQuality,
			"下一次, 退出条件写成三锚: 价格锚 + 时间锚 + 一条外部可观察信号. 这是把凸性还原成现金的开关, 不接受'看情况'."
	case domain.DimExecution:
		return domain.FocusDecisionSpeed,
			"下一次, 从签字到下单不超过 24 小时. 犹豫几周 = inside view 反复推翻 base rate, 命题与持仓在此断裂."
	}
	return domain.FocusInferenceDepth,
		"下一次, 推演链至少跑到第三跳, 并用 2 个以上学科 lens 交叉看一遍."
}

func (s *Service) Get(ctx context.Context, userID, id uuid.UUID) (*Retrospect, error) {
	return s.repo.Get(ctx, userID, id)
}

func (s *Service) GetByCommitment(ctx context.Context, userID, commitID uuid.UUID) (*Retrospect, error) {
	return s.repo.GetByCommitment(ctx, userID, commitID)
}

func (s *Service) List(ctx context.Context, userID uuid.UUID, limit int, projectID *uuid.UUID) ([]Retrospect, error) {
	return s.repo.List(ctx, userID, limit, projectID)
}

func (s *Service) LatestTrainingFocus(ctx context.Context, userID uuid.UUID) (string, string, error) {
	return s.repo.LatestTrainingFocus(ctx, userID)
}
