// Package recommend 是「主动信号推荐」模块.
//
// 本期 (P0「画像底座」, docs/技术文档/12_主动信号推荐_开发文档.md §7) 只做一件事:
// 从既有行为轨迹派生每用户 alpha 画像 (user_alpha_profile), 供日后 (P1+) 的策展漏斗
// 粗排候选用. 无 UI、不推送、不调 Mastra —— 那些都在后续分期.
//
// 形态备忘 (migrations/024):
//   - user_alpha_profile 是派生投影, 不写 events 表 (同 distillation / subscription 先例).
//     完全由 signals / gate_evaluations / commitments / holdings / retrospects / 转信号的
//     tweets 重算得出, 可丢弃可重建. builder 周期性 (P0 手动触发, P1 cron) upsert.
//   - 严格 per-user: 所有读 SQL 都按 user_id 过滤, 画像一行一用户.
package recommend

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/google/uuid"

	"alphax/server/internal/infra/db"
)

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// ───────────────────────── 画像持久化形态 ─────────────────────────

// Profile 是一行 user_alpha_profile 的内存形态 (builder 产出 / repo 落库).
type Profile struct {
	UserID           uuid.UUID
	TagAffinity      map[string]float64 // 归一化 0..1
	CategoryAffinity map[string]float64 // 归一化 0..1
	Conviction       ConvictionShape
	Weaknesses       Weaknesses
	ActiveTheses     []Thesis
	BuiltFromUntil   *time.Time
	SampleSize       int
}

// ConvictionShape — 确信形态: 用户在四道门上的通过/否决统计.
type ConvictionShape struct {
	EvaluationsTotal    int            `json:"evaluations_total"`
	Passed              int            `json:"passed"`
	Failed              int            `json:"failed"`
	PassRate            float64        `json:"pass_rate"`             // passed / total, 2 位小数
	FailedGateHistogram map[string]int `json:"failed_gate_histogram"` // {"1":n,"2":n,"3":n,"4":n}
	TypicalFailedGate   *int           `json:"typical_failed_gate"`   // 最常失败的门 (众数); 无否决时 nil
}

// Weaknesses — 自知弱项: 复盘里用户自己认的短板.
type Weaknesses struct {
	DominantDim string          `json:"dominant_dim,omitempty"` // 最常出现的 focus_dim
	DimCounts   map[string]int  `json:"dim_counts"`
	Recent      []WeaknessEntry `json:"recent"` // 最近若干条, 新→旧
}

type WeaknessEntry struct {
	Dim  string    `json:"dim"`
	Text string    `json:"text,omitempty"`
	At   time.Time `json:"at"`
}

// Thesis — 活跃命题快照 (已签承诺 + 在持持仓).
type Thesis struct {
	Asset          string     `json:"asset"`
	Action         string     `json:"action,omitempty"`
	ExitConditions []string   `json:"exit_conditions"`
	ExpiresAt      *time.Time `json:"expires_at,omitempty"`
}

// ───────────────────────── 读: 各行为源 ─────────────────────────

// SignalTagRow — 一条 done 信号的标签 + 它在漏斗里走了多深 (用于加权).
type SignalTagRow struct {
	Tags       []string
	Refined    bool // 有 status=completed 的五轮追问
	PassedGate bool // 该追问四道门全过
	Committed  bool // 进而签下承诺
}

// SignalTagRows 取该用户全部 done 信号的标签 + 漏斗深度标记.
// 深度由 EXISTS 子查询判定 (各自命中 refinement/gate/commitment 的唯一/外键索引):
//
//	refined    = 该 signal 有一次 status='completed' 的 refinement_session
//	passedGate = 该 refinement 的 gate_evaluation passed
//	committed  = 该 evaluation 产出了 status='signed' 的 commitment
func (r *Repository) SignalTagRows(ctx context.Context, userID uuid.UUID) ([]SignalTagRow, error) {
	const q = `
		SELECT
			COALESCE(s.inference_tags, '{}'),
			EXISTS (
				SELECT 1 FROM refinement_sessions rs
				WHERE rs.primary_signal_id = s.id AND rs.status = 'completed'
			) AS refined,
			EXISTS (
				SELECT 1 FROM refinement_sessions rs
				JOIN gate_evaluations ge ON ge.refinement_id = rs.id
				WHERE rs.primary_signal_id = s.id AND ge.passed
			) AS passed_gate,
			EXISTS (
				SELECT 1 FROM refinement_sessions rs
				JOIN gate_evaluations ge ON ge.refinement_id = rs.id
				JOIN commitments cm ON cm.evaluation_id = ge.id
				WHERE rs.primary_signal_id = s.id AND cm.status = 'signed'
			) AS committed
		FROM signals s
		WHERE s.user_id = $1 AND s.inference_status = 'done'
	`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("signal tag rows: %w", err)
	}
	defer rows.Close()
	var out []SignalTagRow
	for rows.Next() {
		var row SignalTagRow
		if err := rows.Scan(&row.Tags, &row.Refined, &row.PassedGate, &row.Committed); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// GateOutcome — 一次四道门评估的结果 (FailedGate 1..4 为否决门, nil 为通过).
type GateOutcome struct {
	Passed     bool
	FailedGate *int
}

func (r *Repository) GateOutcomes(ctx context.Context, userID uuid.UUID) ([]GateOutcome, error) {
	const q = `SELECT passed, failed_gate FROM gate_evaluations WHERE user_id = $1`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("gate outcomes: %w", err)
	}
	defer rows.Close()
	var out []GateOutcome
	for rows.Next() {
		var g GateOutcome
		if err := rows.Scan(&g.Passed, &g.FailedGate); err != nil {
			return nil, err
		}
		out = append(out, g)
	}
	return out, rows.Err()
}

// thesisJSON — commitments.thesis 里我们关心的字段 (其余忽略).
type thesisJSON struct {
	AssetTicker string `json:"asset_ticker"`
	AssetName   string `json:"asset_name"`
	Action      string `json:"action"`
}

// ActiveTheses 取"在持命题": 已签承诺 (commitments.status='signed') 且持仓仍未了结
// (holdings.status IN active/triggered). exit_conditions 取持仓上物化的那份 (与承诺书同源).
func (r *Repository) ActiveTheses(ctx context.Context, userID uuid.UUID) ([]Thesis, error) {
	const q = `
		SELECT c.thesis, h.exit_conditions, h.expires_at
		FROM commitments c
		JOIN holdings h ON h.id = c.id
		WHERE c.user_id = $1 AND c.status = 'signed'
		  AND h.status IN ('active', 'triggered')
		ORDER BY h.expires_at ASC NULLS LAST
	`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("active theses: %w", err)
	}
	defer rows.Close()
	var out []Thesis
	for rows.Next() {
		var thesisRaw, exitRaw []byte
		var expiresAt time.Time
		if err := rows.Scan(&thesisRaw, &exitRaw, &expiresAt); err != nil {
			return nil, err
		}
		var tj thesisJSON
		if len(thesisRaw) > 0 {
			_ = json.Unmarshal(thesisRaw, &tj) // 容错: 文书结构异常不阻断画像
		}
		asset := tj.AssetTicker
		if asset == "" {
			asset = tj.AssetName
		}
		var exits []string
		if len(exitRaw) > 0 {
			_ = json.Unmarshal(exitRaw, &exits)
		}
		exp := expiresAt
		out = append(out, Thesis{
			Asset:          asset,
			Action:         tj.Action,
			ExitConditions: exits,
			ExpiresAt:      &exp,
		})
	}
	return out, rows.Err()
}

// WeaknessRows 取已定稿复盘里的训练重点 (focus_dim/focus_text), 新→旧.
func (r *Repository) WeaknessRows(ctx context.Context, userID uuid.UUID) ([]WeaknessEntry, error) {
	const q = `
		SELECT focus_dim, COALESCE(focus_text, ''), finalized_at
		FROM retrospects
		WHERE user_id = $1 AND state = 'finalized'
		  AND focus_dim IS NOT NULL AND finalized_at IS NOT NULL
		ORDER BY finalized_at DESC
	`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("weakness rows: %w", err)
	}
	defer rows.Close()
	var out []WeaknessEntry
	for rows.Next() {
		var w WeaknessEntry
		if err := rows.Scan(&w.Dim, &w.Text, &w.At); err != nil {
			return nil, err
		}
		out = append(out, w)
	}
	return out, rows.Err()
}

// readClassifiedTweet — 用户已读且分类完成的推文 (转信号的候选集合).
type readClassifiedTweet struct {
	ID       string
	Category string
}

// readClassifiedTweets 取该用户已读 + 分类完成 + 有 category 的推文.
// "已读"是转信号候选的天然上界: Promote 会顺手记已读, 所以被转的推文必在 tweet_reads 内.
func (r *Repository) readClassifiedTweets(ctx context.Context, userID uuid.UUID) ([]readClassifiedTweet, error) {
	const q = `
		SELECT t.id, t.category
		FROM tweets t
		JOIN tweet_reads tr ON tr.tweet_id = t.id
		WHERE tr.user_id = $1 AND t.classify_status = 'done' AND t.category IS NOT NULL
	`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("read classified tweets: %w", err)
	}
	defer rows.Close()
	var out []readClassifiedTweet
	for rows.Next() {
		var t readClassifiedTweet
		if err := rows.Scan(&t.ID, &t.Category); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// existingEventCIDs 在该用户的 events 里筛出 cids 中真实存在的那些.
// events 有 UNIQUE(user_id, client_event_id), 命中即说明对应推文确被转过信号.
func (r *Repository) existingEventCIDs(ctx context.Context, userID uuid.UUID, cids []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool)
	if len(cids) == 0 {
		return out, nil
	}
	const q = `SELECT client_event_id FROM events WHERE user_id = $1 AND client_event_id = ANY($2)`
	rows, err := r.pool.Query(ctx, q, userID, cids)
	if err != nil {
		return nil, fmt.Errorf("existing event cids: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

// PromotedCategories 还原"被转信号的推文"的 category 列表 (category_affinity 的唯一来源).
//
// 转信号链路无 from_tweet_id 列 —— Promote 复用 signal.Capture, 但用确定性 client_event_id
//
//	= uuidV5(NameSpaceOID, "tweet-promote:<user>:<tweet>") (见 subscription/service.go Promote).
//
// 故这里反推: 取用户已读+分类的推文, 在 Go 里按同一公式算出期望 cid, 再查 events 命中者
// 即为被转过的推文. 公式必须与 subscription 一致 —— 见 promoteClientEventID 的契约注释 + 单测.
func (r *Repository) PromotedCategories(ctx context.Context, userID uuid.UUID) ([]string, error) {
	tweets, err := r.readClassifiedTweets(ctx, userID)
	if err != nil {
		return nil, err
	}
	if len(tweets) == 0 {
		return nil, nil
	}
	cids := make([]uuid.UUID, 0, len(tweets))
	cidToCategory := make(map[uuid.UUID]string, len(tweets))
	for _, t := range tweets {
		cid := promoteClientEventID(userID, t.ID)
		cids = append(cids, cid)
		cidToCategory[cid] = t.Category
	}
	hit, err := r.existingEventCIDs(ctx, userID, cids)
	if err != nil {
		return nil, err
	}
	var cats []string
	for cid := range hit {
		if cat, ok := cidToCategory[cid]; ok {
			cats = append(cats, cat)
		}
	}
	return cats, nil
}

// BehaviorHighWater 取该用户最新一次行为的时间点 (built_from_until). 无行为 → nil.
func (r *Repository) BehaviorHighWater(ctx context.Context, userID uuid.UUID) (*time.Time, error) {
	const q = `
		SELECT max(ts) FROM (
			SELECT max(captured_at)  AS ts FROM signals            WHERE user_id = $1
			UNION ALL SELECT max(evaluated_at) FROM gate_evaluations WHERE user_id = $1
			UNION ALL SELECT max(signed_at)    FROM commitments      WHERE user_id = $1 AND signed_at IS NOT NULL
			UNION ALL SELECT max(finalized_at) FROM retrospects      WHERE user_id = $1 AND finalized_at IS NOT NULL
			UNION ALL SELECT max(completed_at) FROM refinement_sessions WHERE user_id = $1 AND completed_at IS NOT NULL
		) x
	`
	var ts *time.Time
	if err := r.pool.QueryRow(ctx, q, userID).Scan(&ts); err != nil {
		return nil, fmt.Errorf("behavior high water: %w", err)
	}
	return ts, nil
}

// ListUserIDsWithBehavior 取所有有行为可派生画像的用户 (有过 signal 即算). 用于全量重算.
func (r *Repository) ListUserIDsWithBehavior(ctx context.Context) ([]uuid.UUID, error) {
	rows, err := r.pool.Query(ctx, `SELECT DISTINCT user_id FROM signals`)
	if err != nil {
		return nil, fmt.Errorf("list users with behavior: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ───────────────────────── W2 · 策展漏斗的源读 ─────────────────────────

// CommitmentTarget — 一条活跃已签命题 (策展的锚: 只对你已押下的命题召情报, 几乎不可能是噪音).
type CommitmentTarget struct {
	ID             uuid.UUID
	Asset          string // thesis.asset_ticker
	AssetName      string // thesis.asset_name
	Action         string // thesis.action
	ExitConditions []string
	Reasons        []string // thesis.reasons_for_future_self (供 W3 Mastra 精排)
}

// thesisFullJSON — W2 需要的 thesis 字段 (比 P0 thesisJSON 多 exit_conditions/reasons).
type thesisFullJSON struct {
	AssetTicker    string   `json:"asset_ticker"`
	AssetName      string   `json:"asset_name"`
	Action         string   `json:"action"`
	ExitConditions []string `json:"exit_conditions"`
	Reasons        []string `json:"reasons_for_future_self"`
}

// ActiveSignedCommitments 取该用户在持的已签命题 (commitments.signed + holdings active/triggered).
func (r *Repository) ActiveSignedCommitments(ctx context.Context, userID uuid.UUID) ([]CommitmentTarget, error) {
	const q = `
		SELECT c.id, c.thesis
		FROM commitments c
		JOIN holdings h ON h.id = c.id
		WHERE c.user_id = $1 AND c.status = 'signed' AND h.status IN ('active', 'triggered')
		ORDER BY h.expires_at ASC NULLS LAST
	`
	rows, err := r.pool.Query(ctx, q, userID)
	if err != nil {
		return nil, fmt.Errorf("active signed commitments: %w", err)
	}
	defer rows.Close()
	var out []CommitmentTarget
	for rows.Next() {
		var id uuid.UUID
		var thesisRaw []byte
		if err := rows.Scan(&id, &thesisRaw); err != nil {
			return nil, err
		}
		var tj thesisFullJSON
		if len(thesisRaw) > 0 {
			_ = json.Unmarshal(thesisRaw, &tj) // 容错: 文书异常不阻断策展
		}
		out = append(out, CommitmentTarget{
			ID: id, Asset: tj.AssetTicker, AssetName: tj.AssetName, Action: tj.Action,
			ExitConditions: tj.ExitConditions, Reasons: tj.Reasons,
		})
	}
	return out, rows.Err()
}

// CandidateTweet — 进粗排的候选推文.
type CandidateTweet struct {
	ID        string
	Text      string
	Summary   string
	Relevance float64
	CreatedAt time.Time
	Tags      []string
}

// CandidateTweetsForAsset 取与某命题标的相关的候选推文 (红线: 紧贴持仓标的, 宁可不推).
// 候选 = 用户订阅源里、近 windowDays 天、relevance≥min、未读、未对该命题推过、
//
//	且文本/标签命中 terms (命题的 ticker/名) 的已分类推文.
//
// (13 标的归一落地后, 可换成按 signal_assets 精确 ticker 匹配 — 见计划 §7 依赖.)
func (r *Repository) CandidateTweetsForAsset(ctx context.Context, userID, commitmentID uuid.UUID, terms []string, relevanceMin float64, windowDays, limit int) ([]CandidateTweet, error) {
	const q = `
		SELECT t.id, t.text, COALESCE(t.summary,''), COALESCE(t.relevance,0),
		       t.tweet_created_at, COALESCE(t.tags,'{}')
		FROM tweets t
		JOIN subscriptions s ON s.source_type='twitter' AND s.source_id=t.twitter_account_id
		     AND s.user_id=$1 AND s.active
		WHERE t.classify_status='done'
		  AND COALESCE(t.relevance,0) >= $2
		  AND t.tweet_created_at >= now() - make_interval(days => $3)
		  AND NOT EXISTS (SELECT 1 FROM tweet_reads r WHERE r.tweet_id=t.id AND r.user_id=$1)
		  AND NOT EXISTS (SELECT 1 FROM recommendations rec
		                  WHERE rec.user_id=$1 AND rec.source_id=t.id
		                    AND rec.context_type='commitment' AND rec.target_ref=$4)
		  AND EXISTS (SELECT 1 FROM unnest($5::text[]) term
		              WHERE term <> '' AND (t.text ILIKE '%'||term||'%' OR term = ANY(t.tags)))
		ORDER BY COALESCE(t.relevance,0) DESC, t.tweet_created_at DESC
		LIMIT $6
	`
	rows, err := r.pool.Query(ctx, q, userID, relevanceMin, windowDays, commitmentID, terms, limit)
	if err != nil {
		return nil, fmt.Errorf("candidate tweets: %w", err)
	}
	defer rows.Close()
	var out []CandidateTweet
	for rows.Next() {
		var t CandidateTweet
		if err := rows.Scan(&t.ID, &t.Text, &t.Summary, &t.Relevance, &t.CreatedAt, &t.Tags); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

// GetProfileTagAffinity 读该用户画像的 tag_affinity (粗排加权用). 无画像 → 空图 (COALESCE 兜底).
func (r *Repository) GetProfileTagAffinity(ctx context.Context, userID uuid.UUID) (map[string]float64, error) {
	var raw []byte
	err := r.pool.QueryRow(ctx,
		`SELECT COALESCE((SELECT tag_affinity FROM user_alpha_profile WHERE user_id=$1), '{}'::jsonb)`,
		userID).Scan(&raw)
	if err != nil {
		return nil, fmt.Errorf("get tag affinity: %w", err)
	}
	out := map[string]float64{}
	if len(raw) > 0 {
		_ = json.Unmarshal(raw, &out)
	}
	return out, nil
}

// ListUsersWithActiveCommitments 取有活跃已签命题的用户 (策展全量遍历的范围).
func (r *Repository) ListUsersWithActiveCommitments(ctx context.Context) ([]uuid.UUID, error) {
	const q = `
		SELECT DISTINCT c.user_id
		FROM commitments c JOIN holdings h ON h.id = c.id
		WHERE c.status = 'signed' AND h.status IN ('active', 'triggered')
	`
	rows, err := r.pool.Query(ctx, q)
	if err != nil {
		return nil, fmt.Errorf("list users with active commitments: %w", err)
	}
	defer rows.Close()
	var out []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out = append(out, id)
	}
	return out, rows.Err()
}

// ───────────────────────── 写: upsert 画像 ─────────────────────────

// UpsertProfile 幂等写入画像 (user_id 主键冲突即整行覆盖). lens_preference 不在此写 —
// P0 留给它 NULL, 预留 P1+ Mastra 回写, upsert 不触碰该列.
func (r *Repository) UpsertProfile(ctx context.Context, p *Profile) error {
	tagJSON, err := marshalAffinity(p.TagAffinity)
	if err != nil {
		return fmt.Errorf("marshal tag_affinity: %w", err)
	}
	catJSON, err := marshalAffinity(p.CategoryAffinity)
	if err != nil {
		return fmt.Errorf("marshal category_affinity: %w", err)
	}
	convJSON, err := json.Marshal(p.Conviction)
	if err != nil {
		return fmt.Errorf("marshal conviction_shape: %w", err)
	}
	weakJSON, err := json.Marshal(p.Weaknesses)
	if err != nil {
		return fmt.Errorf("marshal self_known_weaknesses: %w", err)
	}
	theses := p.ActiveTheses
	if theses == nil {
		theses = []Thesis{}
	}
	thesesJSON, err := json.Marshal(theses)
	if err != nil {
		return fmt.Errorf("marshal active_theses: %w", err)
	}

	const q = `
		INSERT INTO user_alpha_profile
			(user_id, tag_affinity, category_affinity, conviction_shape,
			 self_known_weaknesses, active_theses, built_from_until, sample_size, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
		ON CONFLICT (user_id) DO UPDATE SET
			tag_affinity          = EXCLUDED.tag_affinity,
			category_affinity     = EXCLUDED.category_affinity,
			conviction_shape      = EXCLUDED.conviction_shape,
			self_known_weaknesses = EXCLUDED.self_known_weaknesses,
			active_theses         = EXCLUDED.active_theses,
			built_from_until      = EXCLUDED.built_from_until,
			sample_size           = EXCLUDED.sample_size,
			updated_at            = now()
	`
	_, err = r.pool.Exec(ctx, q, p.UserID, tagJSON, catJSON, convJSON, weakJSON, thesesJSON, p.BuiltFromUntil, p.SampleSize)
	if err != nil {
		return fmt.Errorf("upsert user_alpha_profile: %w", err)
	}
	return nil
}

// marshalAffinity 保证 nil map 落库为 '{}' 而非 'null' (列是 NOT NULL DEFAULT '{}').
func marshalAffinity(m map[string]float64) ([]byte, error) {
	if m == nil {
		m = map[string]float64{}
	}
	return json.Marshal(m)
}
