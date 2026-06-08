package gate

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"go.uber.org/zap"

	"wiseflow/server/internal/domain"
	"wiseflow/server/internal/infra/db"
	"wiseflow/server/internal/infra/mastra"
)

// Service 跑投决会评审 (四位分析师审核). 入口是 Evaluate(refinementID).
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

// OwnsRefinement 校验 refinementID 属于 userID. 给"用户手动触发评估"的 public
// 端点 (降噪页"上投决会") 做 ownership 关. 只读 refinement_sessions, 不评估.
func (s *Service) OwnsRefinement(ctx context.Context, userID, refinementID uuid.UUID) (bool, error) {
	const q = `SELECT 1 FROM refinement_sessions WHERE id = $1 AND user_id = $2`
	var one int
	if err := s.pool.QueryRow(ctx, q, refinementID, userID).Scan(&one); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return false, nil
		}
		return false, fmt.Errorf("check refinement ownership: %w", err)
	}
	return true, nil
}

// EvaluateDetached 后台跑投决会评估并记日志. 调用方需先 OwnsRefinement 校验.
// 不阻塞 HTTP 响应 — 评估含 4 次 LLM 往返, 客户端不该干等 (沉默优于发声, 降噪页
// 不显示 loading). Evaluate 对 refinement_id 幂等, 重复触发不会重复跑 LLM.
func (s *Service) EvaluateDetached(refinementID uuid.UUID) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 90*time.Second)
		defer cancel()
		start := time.Now()
		if _, err := s.Evaluate(ctx, refinementID); err != nil {
			s.logger.Warn("gate manual evaluate failed",
				zap.String("refinement_id", refinementID.String()), zap.Error(err))
			return
		}
		s.logger.Info("gate manual evaluated",
			zap.String("refinement_id", refinementID.String()), zap.Duration("dur", time.Since(start)))
	}()
}

// Evaluate 跑四位分析师 (佐证 / 共识 / 时机 / 能力圈). 任一位没通过立刻沉默归档.
// 若已 evaluate 过 (idempotent on refinement_id), 直接返回已有的.
func (s *Service) Evaluate(ctx context.Context, refinementID uuid.UUID) (*Evaluation, error) {
	// 0) 装载 refinement context: user_id, primary_signal, rounds
	rc, err := s.loadRefinement(ctx, refinementID)
	if err != nil {
		return nil, err
	}

	// 四位分析师并行审核. 每位只读 rc, 彼此独立; 串行会把 4 次 LLM 往返延迟叠加,
	// 并行后墙钟 ≈ 最慢的一位 (各函数内部各自管理超时).
	//   佐证分析师 (G1) · 共识分析师 (G2) · 时机分析师 (G3) · 能力圈分析师 (G4)
	var (
		g1Pass   bool
		g1Count  int
		g1Detail string
		g2Pass   bool
		g2Score  int
		g2Detail string
		g2Dirs   []domain.UnpricedDirection
		g3Pass   bool
		g3Months float64
		g3Detail string
		g4Pass   bool
		g4Sub    domain.GateG4Sub
		g4Detail string
	)
	var wg sync.WaitGroup
	wg.Add(4)
	go func() { defer wg.Done(); g1Pass, g1Count, g1Detail = s.evaluateG1Thickness(ctx, rc) }()
	go func() { defer wg.Done(); g2Pass, g2Score, g2Detail, g2Dirs = s.evaluateG2Consensus(ctx, rc) }()
	go func() { defer wg.Done(); g3Pass, g3Months, g3Detail = s.evaluateG3Window(ctx, rc) }()
	go func() { defer wg.Done(); g4Pass, g4Sub, g4Detail = s.evaluateG4Edge(ctx, rc) }()
	wg.Wait()

	gates := domain.GateDetail{
		G1Thickness:     domain.GateG1{Pass: g1Pass, Count: g1Count, Detail: stringPtr(g1Detail)},
		G2AntiConsensus: domain.GateG2{Pass: g2Pass, Score: g2Score, Detail: stringPtr(g2Detail), UnpricedDirections: g2Dirs},
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
	UserID               uuid.UUID
	RefinementID         uuid.UUID
	PrimarySignalID      uuid.UUID
	PrimaryAsset         *string
	PrimarySignalRawText string
	PrimarySignalSummary string
	PrimarySignalTags    []string
	ProjectID            *uuid.UUID // 信号所属分类; nil = 未分类. 用于 G1 同分类优先召回
	ProjectName          string     // 分类名 (经 signal.project_id JOIN projects); "" = 未分类
	ProjectGuidance      string     // 分类的分析指引; "" = 无
	Rounds               []domain.RefinementAnsweredPayload
}

func (s *Service) loadRefinement(ctx context.Context, refinementID uuid.UUID) (*refinementContext, error) {
	const q = `
		SELECT rs.user_id, rs.primary_signal_id, rs.primary_asset,
		       s.raw_text, COALESCE(s.inference_summary, ''), COALESCE(s.inference_tags, ARRAY[]::TEXT[]),
		       s.project_id, COALESCE(p.name, ''), COALESCE(p.guidance, '')
		FROM refinement_sessions rs
		JOIN signals s ON s.id = rs.primary_signal_id
		LEFT JOIN projects p ON p.id = s.project_id
		WHERE rs.id = $1
	`
	rc := &refinementContext{RefinementID: refinementID}
	if err := s.pool.QueryRow(ctx, q, refinementID).Scan(
		&rc.UserID, &rc.PrimarySignalID, &rc.PrimaryAsset,
		&rc.PrimarySignalRawText, &rc.PrimarySignalSummary, &rc.PrimarySignalTags,
		&rc.ProjectID, &rc.ProjectName, &rc.ProjectGuidance,
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

// ───── G1 · 佐证分析师 (ThicknessJudge) ─────

// G1: 优先调 Mastra ThicknessJudge (LLM + RAG 综合判定 single_signal_richness +
// cross_signal_breadth). LLM 给的 reasoning 写进 detail / human_reason.
// Mastra 失败 / 未配置 → fallback 老 cluster 启发式.
func (s *Service) evaluateG1Thickness(ctx context.Context, rc *refinementContext) (bool, int, string) {
	// 1) Mastra ThicknessJudge 优先
	if s.mastra != nil && s.mastra.IsConfigured() {
		callCtx, cancel := context.WithTimeout(ctx, 12*time.Second)
		defer cancel()
		projectID := ""
		if rc.ProjectID != nil {
			projectID = rc.ProjectID.String()
		}
		resp, err := s.mastra.ThicknessCheck(callCtx, mastra.ThicknessRequest{
			UserID:          rc.UserID.String(),
			SignalID:        rc.PrimarySignalID.String(),
			RawText:         rc.PrimarySignalRawText,
			Summary:         rc.PrimarySignalSummary,
			Tags:            rc.PrimarySignalTags,
			ProjectID:       projectID,
			ProjectName:     rc.ProjectName,
			ProjectGuidance: rc.ProjectGuidance,
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

// ───── G2 · 共识分析师 (ConsensusCheck, LLM via Mastra; fallback stub) ─────
//
// 阈值: score < 70 → 通过 (leading view, 反共识); ≥ 70 → 失败 (已被定价).
// Mastra 调失败 (URL 未配 / 超时 / Mastra 挂) → 返回 stub (60, pass), 不阻塞主流程.
func (s *Service) evaluateG2Consensus(ctx context.Context, rc *refinementContext) (bool, int, string, []domain.UnpricedDirection) {
	const consensusThreshold = 70

	if !s.mastra.IsConfigured() {
		return true, 60, "Mastra HTTP 未配置, fallback stub (60/pass)", nil
	}

	asset, signalText := assetAndSignalText(rc)

	callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	resp, err := s.mastra.ConsensusCheck(callCtx, mastra.ConsensusRequest{
		Asset:           asset,
		SignalText:      signalText,
		ProjectName:     rc.ProjectName,
		ProjectGuidance: rc.ProjectGuidance,
	})
	if err != nil {
		s.logger.Warn("gate g2 mastra failed, fallback stub",
			zap.String("refinement_id", rc.RefinementID.String()),
			zap.Error(err),
		)
		return true, 60, fmt.Sprintf("Mastra fallback (stub 60/pass): %v", err), nil
	}

	pass := resp.Score < consensusThreshold
	verdict := "leading (反共识)"
	if !pass {
		verdict = "lagging (已被市场定价)"
	}
	detail := fmt.Sprintf("Mastra score=%d (阈值 <%d). %s. summary: %s",
		resp.Score, consensusThreshold, verdict, resp.NarrativeSummary)
	return pass, resp.Score, detail, toDomainDirections(resp.UnpricedDirections)
}

// toDomainDirections 把 mastra 客户端的 unpriced_directions 映射成 domain 类型 (指方向, 不荐股).
// 空切片归一成 nil, 让 GateG2 的 omitempty 在 JSONB / NATS 里彻底省掉这个字段.
func toDomainDirections(in []mastra.UnpricedDirection) []domain.UnpricedDirection {
	if len(in) == 0 {
		return nil
	}
	out := make([]domain.UnpricedDirection, len(in))
	for i, d := range in {
		out[i] = domain.UnpricedDirection{Angle: d.Angle, WhyUnpriced: d.WhyUnpriced, Lens: d.Lens}
	}
	return out
}

// ───── G3 · 时机分析师 (TimingAnalyst) ─────

// G3: 优先调 Mastra TimingCheck — LLM 判催化剂时序 / 前瞻窗口是否成立, 把"用户声明的
// 持仓月数"作为输入之一, 比写死的 [1, 6] 月区间更聪明 (年度催化剂的长窗口也能过,
// 已经发生过的事件即使月数合规也不过). LLM 的 reasoning 写进 detail / human_reason.
// Mastra 失败 / 未配置 → fallback 老规则 (解析持仓月数, 落在 [1, 6] 月算过).
func (s *Service) evaluateG3Window(ctx context.Context, rc *refinementContext) (bool, float64, string) {
	if len(rc.Rounds) < 5 {
		return false, 0, "追问还没答完 5 轮, 时机分析师无法判定窗口"
	}
	statedMonths, source := parseStatedMonths(rc.Rounds[4])

	// 1) 时机分析师 (Mastra) 优先
	if s.mastra.IsConfigured() {
		callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		asset, signalText := assetAndSignalText(rc)
		planText := ""
		if rc.Rounds[4].Answer.OpenText != nil {
			planText = *rc.Rounds[4].Answer.OpenText
		}
		resp, err := s.mastra.TimingCheck(callCtx, mastra.TimingRequest{
			Asset:           asset,
			SignalText:      signalText,
			StatedMonths:    statedMonths,
			PlanText:        planText,
			ProjectName:     rc.ProjectName,
			ProjectGuidance: rc.ProjectGuidance,
		})
		if err == nil {
			months := resp.Months
			if months <= 0 {
				months = statedMonths
			}
			return resp.Pass, months, resp.Reasoning
		}
		s.logger.Warn("g3 timing mastra failed, fallback to month-range rule",
			zap.String("refinement_id", rc.RefinementID.String()),
			zap.Error(err),
		)
	}

	// 2) Fallback: 老规则 — 解析持仓月数, [1, 6] 月算合理窗口 (Phase 2: commitment 应在半年内)
	if statedMonths <= 0 {
		return false, 0, "第 5 轮没解析出持仓时长 (期望 choice_ids 含 dur_*m, 或 open_text 含 'X 个月')"
	}
	pass := statedMonths >= 1 && statedMonths <= 6
	if !pass {
		return false, statedMonths, fmt.Sprintf("解析出 %.1f 月 (源: %s), 不在 [1, 6] 月窗口内", statedMonths, source)
	}
	return true, statedMonths, fmt.Sprintf("窗口 %.1f 月 (源: %s)", statedMonths, source)
}

// parseStatedMonths 从第 5 轮答案解析用户声明的持仓月数.
// 新 schema: choice_ids 找 dur_1m/dur_3m/.../dur_36m; 旧数据 fallback: open_text 正则抠 "X 个月".
func parseStatedMonths(r5 domain.RefinementAnsweredPayload) (float64, string) {
	months := extractDurationFromChoiceIDs(r5.Answer.ChoiceIDs)
	source := "r5.choice_ids"
	if months <= 0 {
		text := ""
		if r5.Answer.OpenText != nil {
			text = *r5.Answer.OpenText
		}
		months = extractDurationMonths(text)
		source = "r5.open_text 正则"
	}
	return months, source
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

// ───── G4 · 能力圈分析师 (CompetenceAnalyst) ─────

// G4 子项:
//   - explain (能解释根因): 优先 Mastra LLM 判 (看第 1 轮答题 + 诊断); fallback 诊断 kind ∈ {correct, partial_miss}
//   - exit_known (给得出可证伪退出条件): 优先 Mastra LLM 判 (看第 5 轮原话); fallback 退出关键词命中
//   - direct (refinement 元数据有 primary_signal): 元数据, 不交给 LLM
//   - track_record (Phase 2 cold start 留空): 看作 null, Phase 3 复盘后再纳入
//
// 通过判定: explain ∧ direct ∧ exit_known (track_record 不计). LLM 给的 reasoning 写进 detail.
func (s *Service) evaluateG4Edge(ctx context.Context, rc *refinementContext) (bool, domain.GateG4Sub, string) {
	sub := domain.GateG4Sub{
		Direct:      rc.PrimarySignalID != uuid.Nil,
		TrackRecord: false, // 冷启动留空 (Phase 3 复盘后再纳入)
	}

	// 1) 能力圈分析师 (Mastra) 优先 — 判 explain / exit_known 两个认知项
	if s.mastra.IsConfigured() && len(rc.Rounds) >= 1 {
		callCtx, cancel := context.WithTimeout(ctx, 15*time.Second)
		defer cancel()
		asset, signalText := assetAndSignalText(rc)
		exitText := ""
		if len(rc.Rounds) >= 5 && rc.Rounds[4].Answer.OpenText != nil {
			exitText = *rc.Rounds[4].Answer.OpenText
		}
		resp, err := s.mastra.CompetenceCheck(callCtx, mastra.CompetenceRequest{
			Asset:           asset,
			SignalText:      signalText,
			Direct:          sub.Direct,
			Round1Text:      renderRound1(rc.Rounds[0]),
			ExitText:        exitText,
			ProjectName:     rc.ProjectName,
			ProjectGuidance: rc.ProjectGuidance,
		})
		if err == nil {
			sub.Explain = resp.Explain
			sub.ExitKnown = resp.ExitKnown
			pass := sub.Explain && sub.Direct && sub.ExitKnown
			return pass, sub, resp.Reasoning
		}
		s.logger.Warn("g4 competence mastra failed, fallback to keyword heuristic",
			zap.String("refinement_id", rc.RefinementID.String()),
			zap.Error(err),
		)
	}

	// 2) Fallback: 老启发式 (诊断 kind + 退出关键词)
	if len(rc.Rounds) >= 1 {
		sub.Explain = rc.Rounds[0].Diagnosis.Kind == domain.DiagnosisCorrect ||
			rc.Rounds[0].Diagnosis.Kind == domain.DiagnosisPartialMiss
	}
	if len(rc.Rounds) >= 5 {
		text := ""
		if rc.Rounds[4].Answer.OpenText != nil {
			text = *rc.Rounds[4].Answer.OpenText
		}
		sub.ExitKnown = hasExitConditionKeywords(text)
	}
	pass := sub.Explain && sub.Direct && sub.ExitKnown
	detail := fmt.Sprintf("能力圈分析师(规则兜底): 讲得清=%v · 亲历=%v · 知退=%v (track_record 冷启动留空)",
		sub.Explain, sub.Direct, sub.ExitKnown)
	return pass, sub, detail
}

// renderRound1 把第 1 轮的题 + 用户选择 + 系统诊断渲染成给能力圈分析师看的文本.
func renderRound1(r1 domain.RefinementAnsweredPayload) string {
	var b strings.Builder
	fmt.Fprintf(&b, "问题: %s\n", r1.QuestionText)
	idToText := make(map[string]string, len(r1.Options))
	for _, o := range r1.Options {
		idToText[o.ID] = o.Text
	}
	if len(r1.Answer.ChoiceIDs) > 0 {
		picks := make([]string, 0, len(r1.Answer.ChoiceIDs))
		for _, id := range r1.Answer.ChoiceIDs {
			if t, ok := idToText[id]; ok {
				picks = append(picks, t)
			} else {
				picks = append(picks, id)
			}
		}
		fmt.Fprintf(&b, "用户选择: %s\n", strings.Join(picks, " / "))
	}
	if r1.Answer.OpenText != nil && *r1.Answer.OpenText != "" {
		fmt.Fprintf(&b, "用户自填: %s\n", *r1.Answer.OpenText)
	}
	fmt.Fprintf(&b, "系统诊断: %s", r1.Diagnosis.Kind)
	if r1.Diagnosis.Note != nil && *r1.Diagnosis.Note != "" {
		fmt.Fprintf(&b, " (%s)", *r1.Diagnosis.Note)
	}
	return b.String()
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
// 任一位分析师没通过就立即沉默归档. humanReason 优先用该分析师给出的一句话 (LLM reasoning),
// 没有时退回固定文案. 池子按是哪位分析师拦下分:
//   - 佐证分析师 (G1) 没过 → observation (证据还不够厚, 继续观察)
//   - 共识分析师 (G2) 没过 → discard   (已经被市场充分定价)
//   - 时机分析师 (G3) 没过 → calendar  (时机问题, 等窗口)
//   - 能力圈分析师 (G4) 没过 → lesson  (能力圈外, 这条记下来当教训)
func classifyFailure(gates domain.GateDetail) (*int, domain.ArchivePool, string) {
	one, two, three, four := 1, 2, 3, 4
	if !gates.G1Thickness.Pass {
		return &one, domain.PoolObservation,
			detailOr(gates.G1Thickness.Detail, "佐证分析师: 目前看到的独立证据还不够厚. 这一条先放观察池, 等更多角度的同一观察再来.")
	}
	if !gates.G2AntiConsensus.Pass {
		return &two, domain.PoolDiscard,
			detailOr(gates.G2AntiConsensus.Detail, "共识分析师: 这件事市场已经讨论得很热了. 你看见的不算 leading, 这一条不进承诺书.")
	}
	if !gates.G3Window.Pass {
		return &three, domain.PoolCalendar,
			detailOr(gates.G3Window.Detail, "时机分析师: 时机不在你的窗口里. 这一条先放日历池, 时间到了再回来看.")
	}
	if !gates.G4Edge.Pass {
		return &four, domain.PoolLesson,
			detailOr(gates.G4Edge.Detail, "能力圈分析师: 这一条超出你目前的能力圈半径. 它进 lesson 池, 等你下次到能解释它的位置.")
	}
	return nil, "", ""
}

// detailOr 优先返回分析师给的一句话 reasoning (面向用户); 为空时退回固定文案.
func detailOr(detail *string, fallback string) string {
	if detail != nil && strings.TrimSpace(*detail) != "" {
		return *detail
	}
	return fallback
}

// assetAndSignalText 给分析师 prompt 用的资产名 + 信号原文 (带兜底占位).
func assetAndSignalText(rc *refinementContext) (string, string) {
	asset := "?"
	if rc.PrimaryAsset != nil && *rc.PrimaryAsset != "" {
		asset = *rc.PrimaryAsset
	}
	signalText := rc.PrimarySignalRawText
	if signalText == "" {
		signalText = "(信号原文未取到)"
	}
	return asset, signalText
}

func stringPtr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
