package gate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"flashfi/server/internal/domain"
	"flashfi/server/internal/infra/db"
	"flashfi/server/internal/infra/mastra"
)

// Service 跑四道门. 入口是 Evaluate(refinementID).
type Service struct {
	repo   *Repository
	pool   *db.Pool // 直接查 events / signals / refinement_sessions, 跨模块只读
	mastra *mastra.Client
	logger *zap.Logger
}

func NewService(repo *Repository, pool *db.Pool, mc *mastra.Client, logger *zap.Logger) *Service {
	if logger == nil {
		logger = zap.NewNop()
	}
	return &Service{repo: repo, pool: pool, mastra: mc, logger: logger}
}

// Evaluate 串行跑 G1, G2, G3, G4. 任一门失败立刻沉默归档.
// 若已 evaluate 过 (idempotent on refinement_id), 直接返回已有的.
func (s *Service) Evaluate(ctx context.Context, refinementID uuid.UUID) (*Evaluation, error) {
	// 0) 装载 refinement context: user_id, primary_signal, rounds
	rc, err := s.loadRefinement(ctx, refinementID)
	if err != nil {
		return nil, err
	}

	// 1) G1 信号厚度
	g1Pass, g1Count, g1Detail := s.evaluateG1Thickness(ctx, rc)

	// 2) G2 反共识 — Mastra ConsensusCheck (fallback: stub)
	g2Pass, g2Score, g2Detail := s.evaluateG2Consensus(ctx, rc)

	// 3) G3 窗口期
	g3Pass, g3Months, g3Detail := s.evaluateG3Window(rc)

	// 4) G4 在不在能力圈
	g4Pass, g4Sub, g4Detail := s.evaluateG4Edge(rc)

	gates := domain.GateDetail{
		G1Thickness:     domain.GateG1{Pass: g1Pass, Count: g1Count, Detail: stringPtr(g1Detail)},
		G2AntiConsensus: domain.GateG2{Pass: g2Pass, Score: g2Score, Detail: stringPtr(g2Detail)},
		G3Window:        domain.GateG3{Pass: g3Pass, Months: g3Months, Detail: stringPtr(g3Detail)},
		G4Edge:          domain.GateG4{Pass: g4Pass, Sub: g4Sub, Detail: stringPtr(g4Detail)},
	}

	// 串行短路 + 池分配
	failedGate, pool, humanReason := classifyFailure(gates)
	passed := failedGate == nil
	var poolPtr *domain.ArchivePool
	if pool != "" {
		p := pool
		poolPtr = &p
	}

	return s.repo.Insert(ctx, InsertInput{
		UserID:       rc.UserID,
		RefinementID: refinementID,
		Gates:        gates,
		Passed:       passed,
		FailedGate:   failedGate,
		ArchivedPool: poolPtr,
		HumanReason:  humanReason,
	})
}

// ───── refinement context ─────

type refinementContext struct {
	UserID                 uuid.UUID
	RefinementID           uuid.UUID
	PrimarySignalID        uuid.UUID
	PrimaryAsset           *string
	PrimarySignalRawText   string
	PrimarySignalSummary   string
	PrimarySignalTags      []string
	Rounds                 []domain.RefinementAnsweredPayload
}

func (s *Service) loadRefinement(ctx context.Context, refinementID uuid.UUID) (*refinementContext, error) {
	const q = `
		SELECT rs.user_id, rs.primary_signal_id, rs.primary_asset,
		       s.raw_text, COALESCE(s.inference_summary, ''), COALESCE(s.inference_tags, ARRAY[]::TEXT[])
		FROM refinement_sessions rs
		JOIN signals s ON s.id = rs.primary_signal_id
		WHERE rs.id = $1
	`
	rc := &refinementContext{RefinementID: refinementID}
	if err := s.pool.QueryRow(ctx, q, refinementID).Scan(
		&rc.UserID, &rc.PrimarySignalID, &rc.PrimaryAsset,
		&rc.PrimarySignalRawText, &rc.PrimarySignalSummary, &rc.PrimarySignalTags,
	); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("refinement %s not found", refinementID)
		}
		return nil, fmt.Errorf("load refinement: %w", err)
	}

	// 加载五轮答题 (按 round 升序)
	const qRounds = `
		SELECT payload FROM events
		WHERE type = $1 AND (payload->>'refinement_id')::uuid = $2
		ORDER BY (payload->>'round')::int ASC
	`
	rows, err := s.pool.Query(ctx, qRounds, string(domain.EventRefinementAnswered), refinementID)
	if err != nil {
		return nil, fmt.Errorf("query rounds: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var raw json.RawMessage
		if err := rows.Scan(&raw); err != nil {
			return nil, fmt.Errorf("scan round: %w", err)
		}
		var p domain.RefinementAnsweredPayload
		if err := json.Unmarshal(raw, &p); err != nil {
			return nil, fmt.Errorf("unmarshal round payload: %w", err)
		}
		rc.Rounds = append(rc.Rounds, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return rc, nil
}

// ───── G1 · 信号厚度 ─────

// G1: 优先调 Mastra ThicknessJudge (LLM + RAG 综合判定 single_signal_richness +
// cross_signal_breadth). LLM 给的 reasoning 写进 detail / human_reason.
// Mastra 失败 / 未配置 → fallback 老 cluster 启发式.
func (s *Service) evaluateG1Thickness(ctx context.Context, rc *refinementContext) (bool, int, string) {
	// 1) Mastra ThicknessJudge 优先
	if s.mastra != nil && s.mastra.IsConfigured() {
		callCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		defer cancel()
		resp, err := s.mastra.ThicknessCheck(callCtx, mastra.ThicknessRequest{
			UserID:   rc.UserID.String(),
			SignalID: rc.PrimarySignalID.String(),
			RawText:  rc.PrimarySignalRawText,
			Summary:  rc.PrimarySignalSummary,
			Tags:     rc.PrimarySignalTags,
		})
		if err == nil {
			// detail 只放 LLM reasoning (一句话, classifyFailure 会作为 human_reason 给用户看).
			// score / richness / breadth 已经在 GateG1.Count 等结构化字段里 (web-admin 单独展示).
			return resp.Pass, resp.Score, resp.Reasoning
		}
		s.logger.Warn("g1 mastra failed, fallback to cluster heuristic",
			zap.String("refinement_id", rc.RefinementID.String()),
			zap.Error(err),
		)
	}
	// 2) Fallback: 老 cluster 算法 (近 14 天 ≥ 3 个独立 tag-cluster)
	return s.evaluateG1ThicknessFallback(ctx, rc)
}

// G1 启发式 fallback (Phase 2 plan § 3.2 风险):
//   - 把 signals 按 inference_tags 取交集 ≥ 1 归一组 (同组算同一观察)
//   - "独立信号" = 不同 tag-cluster, ≥ 3 组就过
//   - 时间窗口 14 天滑动
func (s *Service) evaluateG1ThicknessFallback(ctx context.Context, rc *refinementContext) (bool, int, string) {
	// 拉用户最近 14 天的 signals (含 tags)
	const q = `
		SELECT inference_tags
		FROM signals
		WHERE user_id = $1
		  AND captured_at >= NOW() - INTERVAL '14 days'
		  AND inference_status = 'done'
		ORDER BY captured_at DESC
	`
	rows, err := s.pool.Query(ctx, q, rc.UserID)
	if err != nil {
		return false, 0, fmt.Sprintf("query signals: %v", err)
	}
	defer rows.Close()

	// 收集所有 tags 列表
	var tagSets [][]string
	for rows.Next() {
		var tags []string
		if err := rows.Scan(&tags); err != nil {
			return false, 0, fmt.Sprintf("scan tags: %v", err)
		}
		// 去重 + 小写
		normalized := normalizeTags(tags)
		if len(normalized) > 0 {
			tagSets = append(tagSets, normalized)
		}
	}

	clusters := clusterByTagOverlap(tagSets)
	pass := len(clusters) >= 3
	detail := fmt.Sprintf("近 14 天独立 tag-cluster 数 = %d (阈值 ≥ 3)", len(clusters))
	return pass, len(clusters), detail
}

func normalizeTags(tags []string) []string {
	seen := make(map[string]struct{}, len(tags))
	out := make([]string, 0, len(tags))
	for _, t := range tags {
		k := strings.ToLower(strings.TrimSpace(t))
		if k == "" {
			continue
		}
		if _, dup := seen[k]; dup {
			continue
		}
		seen[k] = struct{}{}
		out = append(out, k)
	}
	return out
}

// clusterByTagOverlap: 简单的 union-find 风格. 两组 tags 有 ≥1 交集就合并.
// O(n²), 14 天信号量 n < 100, 可接受.
func clusterByTagOverlap(tagSets [][]string) [][]string {
	if len(tagSets) == 0 {
		return nil
	}
	parent := make([]int, len(tagSets))
	for i := range parent {
		parent[i] = i
	}
	var find func(int) int
	find = func(x int) int {
		if parent[x] != x {
			parent[x] = find(parent[x])
		}
		return parent[x]
	}
	union := func(a, b int) { parent[find(a)] = find(b) }

	for i := 0; i < len(tagSets); i++ {
		set := makeSet(tagSets[i])
		for j := i + 1; j < len(tagSets); j++ {
			for _, t := range tagSets[j] {
				if _, ok := set[t]; ok {
					union(i, j)
					break
				}
			}
		}
	}

	groups := make(map[int][]string)
	for i := range tagSets {
		root := find(i)
		groups[root] = append(groups[root], tagSets[i]...)
	}
	out := make([][]string, 0, len(groups))
	for _, g := range groups {
		out = append(out, g)
	}
	return out
}

func makeSet(ss []string) map[string]struct{} {
	m := make(map[string]struct{}, len(ss))
	for _, s := range ss {
		m[s] = struct{}{}
	}
	return m
}

// ───── G2 · 反共识 (LLM via Mastra; fallback stub) ─────
//
// 阈值: score < 70 → 通过 (leading view, 反共识); ≥ 70 → 失败 (已被定价).
// Mastra 调失败 (URL 未配 / 超时 / Mastra 挂) → 返回 stub (60, pass), 不阻塞主流程.
func (s *Service) evaluateG2Consensus(ctx context.Context, rc *refinementContext) (bool, int, string) {
	const consensusThreshold = 70

	if !s.mastra.IsConfigured() {
		return true, 60, "Mastra HTTP 未配置, fallback stub (60/pass)"
	}

	asset := "?"
	if rc.PrimaryAsset != nil && *rc.PrimaryAsset != "" {
		asset = *rc.PrimaryAsset
	}
	signalText := rc.PrimarySignalRawText
	if signalText == "" {
		signalText = "(信号原文未取到)"
	}

	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	resp, err := s.mastra.ConsensusCheck(callCtx, mastra.ConsensusRequest{
		Asset:      asset,
		SignalText: signalText,
	})
	if err != nil {
		s.logger.Warn("gate g2 mastra failed, fallback stub",
			zap.String("refinement_id", rc.RefinementID.String()),
			zap.Error(err),
		)
		return true, 60, fmt.Sprintf("Mastra fallback (stub 60/pass): %v", err)
	}

	pass := resp.Score < consensusThreshold
	verdict := "leading (反共识)"
	if !pass {
		verdict = "lagging (已被市场定价)"
	}
	detail := fmt.Sprintf("Mastra score=%d (阈值 <%d). %s. summary: %s",
		resp.Score, consensusThreshold, verdict, resp.NarrativeSummary)
	return pass, resp.Score, detail
}

// ───── G3 · 窗口期 ─────

// G3: 解析 refinement 第 5 轮的持仓时长 (月).
// 新 schema (kind=commitment_setup): 从 user_answer.choice_ids 找 dur_1m / dur_3m / dur_6m / dur_12m / dur_24m / dur_36m.
// 旧 schema (kind=open): 从 user_answer.open_text 正则抠 "X 个月" / "X mo".
// 在 [1, 6] 月算合理窗口, 过 (Phase 2 product 约束: commitment 应在半年内).
func (s *Service) evaluateG3Window(rc *refinementContext) (bool, float64, string) {
	if len(rc.Rounds) < 5 {
		return false, 0, "refinement 还没答完 5 轮, 无法判定窗口期"
	}
	r5 := rc.Rounds[4]

	// 1) 新 schema · 从 choice_ids 找 dur_* id
	months := extractDurationFromChoiceIDs(r5.Answer.ChoiceIDs)
	source := "r5.choice_ids"

	// 2) 老数据 fallback · open_text 正则
	if months <= 0 {
		text := ""
		if r5.Answer.OpenText != nil {
			text = *r5.Answer.OpenText
		}
		months = extractDurationMonths(text)
		source = "r5.open_text 正则"
	}

	if months <= 0 {
		return false, 0, "第 5 轮没解析出持仓时长 (期望 choice_ids 含 dur_*m, 或 open_text 含 'X 个月')"
	}
	pass := months >= 1 && months <= 6
	if !pass {
		return false, months, fmt.Sprintf("解析出 %.1f 月 (源: %s), 不在 [1, 6] 月窗口内", months, source)
	}
	return true, months, fmt.Sprintf("窗口 %.1f 月 (源: %s)", months, source)
}

// commitment_setup r5 的 duration id 规范集. 与 mastra socratic prompt 保持一致.
var durationByChoiceID = map[string]float64{
	"dur_1m":  1,
	"dur_3m":  3,
	"dur_6m":  6,
	"dur_12m": 12,
	"dur_24m": 24,
	"dur_36m": 36,
}

func extractDurationFromChoiceIDs(ids []string) float64 {
	for _, id := range ids {
		if m, ok := durationByChoiceID[id]; ok {
			return m
		}
	}
	return 0
}

var durationPattern = regexp.MustCompile(`(\d+(?:\.\d+)?)\s*(?:个月|月|months?|mo)`)

func extractDurationMonths(text string) float64 {
	m := durationPattern.FindStringSubmatch(text)
	if len(m) < 2 {
		return 0
	}
	f, err := strconv.ParseFloat(m[1], 64)
	if err != nil {
		return 0
	}
	return f
}

// ───── G4 · 能力圈 ─────

// G4 子项 (Phase 2 plan § 3.2):
//   - explain (M5 round 1 答对): correct 或 partial_miss → true
//   - direct (refinement 元数据有 primary_signal): true
//   - track_record (Phase 2 cold start 留 null → 不算 false, 不阻塞)
//   - exit_known (round 5 open_text 至少给出 ≥1 个 exit_condition 关键词): true
//
// 通过判定: explain + direct + exit_known 都 true (track_record 不计).
func (s *Service) evaluateG4Edge(rc *refinementContext) (bool, domain.GateG4Sub, string) {
	sub := domain.GateG4Sub{}

	// explain
	if len(rc.Rounds) >= 1 {
		sub.Explain = rc.Rounds[0].Diagnosis.Kind == domain.DiagnosisCorrect ||
			rc.Rounds[0].Diagnosis.Kind == domain.DiagnosisPartialMiss
	}

	// direct
	sub.Direct = rc.PrimarySignalID != uuid.Nil

	// track_record — cold start 不算 false. 看作 null (Phase 3 复盘后再纳入).
	// Go bool 没 null, 我们留 false 但 detail 里说明.
	sub.TrackRecord = false

	// exit_known
	if len(rc.Rounds) >= 5 {
		text := ""
		if rc.Rounds[4].Answer.OpenText != nil {
			text = *rc.Rounds[4].Answer.OpenText
		}
		sub.ExitKnown = hasExitConditionKeywords(text)
	}

	// Phase 2 通过条件
	pass := sub.Explain && sub.Direct && sub.ExitKnown

	detail := fmt.Sprintf("explain=%v · direct=%v · track_record=null(冷启动) · exit_known=%v",
		sub.Explain, sub.Direct, sub.ExitKnown)
	return pass, sub, detail
}

var exitKeywords = []string{"跌", "破", "退出", "止损", "平仓", "stop", "exit", "如果", "条件", "触发", "下跌"}

func hasExitConditionKeywords(text string) bool {
	if len(strings.TrimSpace(text)) < 20 {
		return false
	}
	lower := strings.ToLower(text)
	hits := 0
	for _, kw := range exitKeywords {
		if strings.Contains(lower, kw) {
			hits++
			if hits >= 1 {
				return true
			}
		}
	}
	return false
}

// ───── 池分配 ─────

// classifyFailure 决定 (failedGate, pool, humanReason).
// 任一门失败立即沉默归档, 池子按门号分:
//   - G1 失败 → observation (信号还不够厚, 继续观察)
//   - G2 失败 → discard (已经被市场充分定价)
//   - G3 失败 → calendar (时机问题, 等)
//   - G4 失败 → lesson (能力圈外, 这条记下来当教训)
func classifyFailure(gates domain.GateDetail) (*int, domain.ArchivePool, string) {
	one := 1
	two := 2
	three := 3
	four := 4
	if !gates.G1Thickness.Pass {
		reason := "目前看到的独立信号还不够厚. 这一条先放观察池里, 等更多角度的同一观察再来."
		if gates.G1Thickness.Detail != nil && *gates.G1Thickness.Detail != "" {
			// LLM reasoning 优先 (一句话直接面向用户).
			reason = *gates.G1Thickness.Detail
		}
		return &one, domain.PoolObservation, reason
	}
	if !gates.G2AntiConsensus.Pass {
		return &two, domain.PoolDiscard,
			"这件事市场已经讨论得很热了. 你看见的不算 leading, 这一条不进承诺书."
	}
	if !gates.G3Window.Pass {
		return &three, domain.PoolCalendar,
			"时机不在你的窗口里. 这一条先放日历池, 时间到了再回来看."
	}
	if !gates.G4Edge.Pass {
		return &four, domain.PoolLesson,
			"这一条超出你目前的能力圈半径. 不强求它, 它进 lesson 池, 等你下次到能解释它的位置."
	}
	return nil, "", ""
}

func stringPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
