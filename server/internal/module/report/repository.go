// Package report 是"早报"模块.
//
// 每天 08:00 (Asia/Shanghai) 调度器把"前一天 [00:00,24:00) 转为信号"的内容,
// 跨所有用户去标识化聚合 (只取 AI 蒸馏层: inference_tags / inference_related_assets /
// k-匿名过滤后的 inference_summary —— 绝不碰 raw_text / 用户身份 / 分类名), 交 Mastra
// 写成一份共享编者社论 (按语言各一份). 用户首次打开时再按其关注标的/活跃分类懒加载个性化.
//
// 两张投影表 (同 distillation, 不写 events): morning_report_globals (共享底稿) +
// morning_report_editions (per-user 缓存). 见 migration 033.
package report

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"alphax/server/internal/infra/db"
)

var ErrNotFound = errors.New("morning report not found")

type Repository struct {
	pool *db.Pool
}

func NewRepository(pool *db.Pool) *Repository {
	return &Repository{pool: pool}
}

// ───── 聚合 (去标识来源: 跨用户, 仅 AI 蒸馏层) ─────

// AssetStat / TagStat — 昨日某标的/标签的聚合计数.
type AssetStat struct {
	Ticker      string // 展示形 (大小写保留)
	Mentions    int    // 被提及总次数
	SignalCount int    // 涉及的不同信号数 (k-匿名按此判定)
}

type TagStat struct {
	Tag         string
	Mentions    int
	SignalCount int
}

// AssetNote — 送 LLM 的去标识摘要 (ticker 为归一小写 key, 供服务层 k-匿名匹配).
type AssetNote struct {
	Ticker  string
	Summary string
}

type Aggregate struct {
	SignalCount int
	TopAssets   []AssetStat
	TopTags     []TagStat
	Summaries   []AssetNote
}

// AggregateWindow 跑去标识聚合. 窗口 [start,end) 按 created_at (= 信号创建/转为信号的时刻),
// 只纳入 inference_status='done' 的信号. 无 user_id 过滤 —— 这正是去标识化的来源.
func (r *Repository) AggregateWindow(ctx context.Context, start, end time.Time) (Aggregate, error) {
	var agg Aggregate

	if err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM signals
		WHERE created_at >= $1 AND created_at < $2 AND inference_status = 'done'
	`, start, end).Scan(&agg.SignalCount); err != nil {
		return agg, fmt.Errorf("count signals: %w", err)
	}

	// top assets: 展开 inference_related_assets (jsonb 数组), 按归一 ticker 聚合.
	assetRows, err := r.queryCounts(ctx, `
		SELECT (array_agg(DISTINCT trim(elem->>'ticker')))[1] AS label,
		       count(*) AS mentions, count(DISTINCT s.id) AS signal_count
		FROM signals s
		CROSS JOIN LATERAL jsonb_array_elements(s.inference_related_assets) AS elem
		WHERE s.created_at >= $1 AND s.created_at < $2
		  AND s.inference_status = 'done'
		  AND jsonb_typeof(s.inference_related_assets) = 'array'
		  AND coalesce(trim(elem->>'ticker'), '') <> ''
		GROUP BY lower(trim(elem->>'ticker'))
		ORDER BY signal_count DESC, mentions DESC
		LIMIT 20
	`, start, end)
	if err != nil {
		return agg, fmt.Errorf("top assets: %w", err)
	}
	for _, c := range assetRows {
		agg.TopAssets = append(agg.TopAssets, AssetStat{Ticker: c.Label, Mentions: c.Mentions, SignalCount: c.SignalCount})
	}

	// top tags: 展开 inference_tags (text[]), 按归一标签聚合.
	tagRows, err := r.queryCounts(ctx, `
		SELECT (array_agg(DISTINCT trim(tag)))[1] AS label,
		       count(*) AS mentions, count(DISTINCT s.id) AS signal_count
		FROM signals s
		CROSS JOIN LATERAL unnest(s.inference_tags) AS tag
		WHERE s.created_at >= $1 AND s.created_at < $2
		  AND s.inference_status = 'done'
		  AND s.inference_tags IS NOT NULL
		  AND coalesce(trim(tag), '') <> ''
		GROUP BY lower(trim(tag))
		ORDER BY signal_count DESC, mentions DESC
		LIMIT 30
	`, start, end)
	if err != nil {
		return agg, fmt.Errorf("top tags: %w", err)
	}
	for _, c := range tagRows {
		agg.TopTags = append(agg.TopTags, TagStat{Tag: c.Label, Mentions: c.Mentions, SignalCount: c.SignalCount})
	}

	// 去标识摘要语料 (按 ticker; 仅 AI 摘要, 绝不取 raw_text). 服务层再做 k-匿名过滤.
	notes, err := r.querySummaries(ctx, start, end)
	if err != nil {
		return agg, fmt.Errorf("summaries: %w", err)
	}
	agg.Summaries = notes

	return agg, nil
}

// AggregateWindowForUser — 同 AggregateWindow, 但只纳入"命中该用户关注"的信号:
//   - 标的维度: related_assets 的 ticker 与 assetTokens 双向子串匹配 (canonical/name).
//   - 主题维度: inference_tags 与 themeTokens 双向子串匹配 (分类 name/guidance).
//
// signalCount = 命中任一维度的不同信号数. topAssets 只取命中 assetTokens 的标的, topTags 只取
// 命中 themeTokens 的标签, 故社论紧扣用户关注. summaries 仅取"提及命中标的"的信号摘要 (key 落在
// topAssets 上, 服务层 k-匿名按其 signal_count 过滤 —— 与全局路径同一隐私模型: 某标的全窗口信号
// 数 >= K 才放行, 不因 per-user 过滤而放松). 来源仍是去标识 AI 蒸馏层, 无 raw_text/用户身份.
//
// assetTokens 与 themeTokens 至少一个非空 (调用方保证); 空的那维跳过.
func (r *Repository) AggregateWindowForUser(ctx context.Context, start, end time.Time, assetTokens, themeTokens []string) (Aggregate, error) {
	var agg Aggregate

	// 命中标的的信号数 (∪) 命中主题的信号数.
	if err := r.pool.QueryRow(ctx, `
		SELECT count(*) FROM signals s
		WHERE s.created_at >= $1 AND s.created_at < $2 AND s.inference_status = 'done'
		  AND (
		    ( cardinality($3::text[]) > 0
		      AND jsonb_typeof(s.inference_related_assets) = 'array'
		      AND EXISTS (
		        SELECT 1 FROM jsonb_array_elements(s.inference_related_assets) AS elem
		        CROSS JOIN unnest($3::text[]) AS tok
		        WHERE coalesce(trim(elem->>'ticker'),'') <> '' AND trim(tok) <> ''
		          AND ( lower(trim(elem->>'ticker')) LIKE '%'||lower(trim(tok))||'%'
		             OR lower(trim(tok)) LIKE '%'||lower(trim(elem->>'ticker'))||'%' )
		      ) )
		    OR
		    ( cardinality($4::text[]) > 0
		      AND s.inference_tags IS NOT NULL
		      AND EXISTS (
		        SELECT 1 FROM unnest(s.inference_tags) AS tag
		        CROSS JOIN unnest($4::text[]) AS tok
		        WHERE coalesce(trim(tag),'') <> '' AND trim(tok) <> ''
		          AND ( lower(trim(tag)) LIKE '%'||lower(trim(tok))||'%'
		             OR lower(trim(tok)) LIKE '%'||lower(trim(tag))||'%' )
		      ) )
		  )
	`, start, end, assetTokens, themeTokens).Scan(&agg.SignalCount); err != nil {
		return agg, fmt.Errorf("count user signals: %w", err)
	}

	// top assets: 仅命中 assetTokens 的标的 (按全窗口计数, 故 signal_count 等同全局, k-匿名口径不变).
	if len(assetTokens) > 0 {
		assetRows, err := r.queryCounts(ctx, `
			SELECT (array_agg(DISTINCT trim(elem->>'ticker')))[1] AS label,
			       count(*) AS mentions, count(DISTINCT s.id) AS signal_count
			FROM signals s
			CROSS JOIN LATERAL jsonb_array_elements(s.inference_related_assets) AS elem
			WHERE s.created_at >= $1 AND s.created_at < $2
			  AND s.inference_status = 'done'
			  AND jsonb_typeof(s.inference_related_assets) = 'array'
			  AND coalesce(trim(elem->>'ticker'), '') <> ''
			  AND EXISTS (
			    SELECT 1 FROM unnest($3::text[]) AS tok
			    WHERE trim(tok) <> ''
			      AND ( lower(trim(elem->>'ticker')) LIKE '%'||lower(trim(tok))||'%'
			         OR lower(trim(tok)) LIKE '%'||lower(trim(elem->>'ticker'))||'%' )
			  )
			GROUP BY lower(trim(elem->>'ticker'))
			ORDER BY signal_count DESC, mentions DESC
			LIMIT 20
		`, start, end, assetTokens)
		if err != nil {
			return agg, fmt.Errorf("user top assets: %w", err)
		}
		for _, c := range assetRows {
			agg.TopAssets = append(agg.TopAssets, AssetStat{Ticker: c.Label, Mentions: c.Mentions, SignalCount: c.SignalCount})
		}
	}

	// top tags: 仅命中 themeTokens 的标签.
	if len(themeTokens) > 0 {
		tagRows, err := r.queryCounts(ctx, `
			SELECT (array_agg(DISTINCT trim(tag)))[1] AS label,
			       count(*) AS mentions, count(DISTINCT s.id) AS signal_count
			FROM signals s
			CROSS JOIN LATERAL unnest(s.inference_tags) AS tag
			WHERE s.created_at >= $1 AND s.created_at < $2
			  AND s.inference_status = 'done'
			  AND s.inference_tags IS NOT NULL
			  AND coalesce(trim(tag), '') <> ''
			  AND EXISTS (
			    SELECT 1 FROM unnest($3::text[]) AS tok
			    WHERE trim(tok) <> ''
			      AND ( lower(trim(tag)) LIKE '%'||lower(trim(tok))||'%'
			         OR lower(trim(tok)) LIKE '%'||lower(trim(tag))||'%' )
			  )
			GROUP BY lower(trim(tag))
			ORDER BY signal_count DESC, mentions DESC
			LIMIT 30
		`, start, end, themeTokens)
		if err != nil {
			return agg, fmt.Errorf("user top tags: %w", err)
		}
		for _, c := range tagRows {
			agg.TopTags = append(agg.TopTags, TagStat{Tag: c.Label, Mentions: c.Mentions, SignalCount: c.SignalCount})
		}
	}

	// 摘要语料: 仅取"提及命中标的"的信号 (key 落在 topAssets, 服务层按 K 过滤). themeTokens 为空则无标的→无摘要.
	if len(assetTokens) > 0 {
		notes, err := r.querySummariesForTokens(ctx, start, end, assetTokens)
		if err != nil {
			return agg, fmt.Errorf("user summaries: %w", err)
		}
		agg.Summaries = notes
	}

	return agg, nil
}

func (r *Repository) querySummariesForTokens(ctx context.Context, start, end time.Time, assetTokens []string) ([]AssetNote, error) {
	const q = `
		SELECT lower(trim(elem->>'ticker')) AS ticker_key, s.inference_summary
		FROM signals s
		CROSS JOIN LATERAL jsonb_array_elements(s.inference_related_assets) AS elem
		WHERE s.created_at >= $1 AND s.created_at < $2
		  AND s.inference_status = 'done'
		  AND jsonb_typeof(s.inference_related_assets) = 'array'
		  AND s.inference_summary IS NOT NULL
		  AND coalesce(trim(elem->>'ticker'), '') <> ''
		  AND EXISTS (
		    SELECT 1 FROM unnest($3::text[]) AS tok
		    WHERE trim(tok) <> ''
		      AND ( lower(trim(elem->>'ticker')) LIKE '%'||lower(trim(tok))||'%'
		         OR lower(trim(tok)) LIKE '%'||lower(trim(elem->>'ticker'))||'%' )
		  )
		ORDER BY s.created_at DESC
		LIMIT 200
	`
	rows, err := r.pool.Query(ctx, q, start, end, assetTokens)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AssetNote
	for rows.Next() {
		var n AssetNote
		if err := rows.Scan(&n.Ticker, &n.Summary); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

type countRow struct {
	Label       string
	Mentions    int
	SignalCount int
}

func (r *Repository) queryCounts(ctx context.Context, q string, args ...any) ([]countRow, error) {
	rows, err := r.pool.Query(ctx, q, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []countRow
	for rows.Next() {
		var c countRow
		if err := rows.Scan(&c.Label, &c.Mentions, &c.SignalCount); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (r *Repository) querySummaries(ctx context.Context, start, end time.Time) ([]AssetNote, error) {
	const q = `
		SELECT lower(trim(elem->>'ticker')) AS ticker_key, s.inference_summary
		FROM signals s
		CROSS JOIN LATERAL jsonb_array_elements(s.inference_related_assets) AS elem
		WHERE s.created_at >= $1 AND s.created_at < $2
		  AND s.inference_status = 'done'
		  AND jsonb_typeof(s.inference_related_assets) = 'array'
		  AND s.inference_summary IS NOT NULL
		  AND coalesce(trim(elem->>'ticker'), '') <> ''
		ORDER BY s.created_at DESC
		LIMIT 200
	`
	rows, err := r.pool.Query(ctx, q, start, end)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []AssetNote
	for rows.Next() {
		var n AssetNote
		if err := rows.Scan(&n.Ticker, &n.Summary); err != nil {
			return nil, err
		}
		out = append(out, n)
	}
	return out, rows.Err()
}

// ───── 全局底稿 (morning_report_globals) ─────

type Global struct {
	EditionDate string
	Language    string
	SignalCount int
	IsQuiet     bool
	TopAssets   json.RawMessage
	TopTags     json.RawMessage
	Headline    *string
	Dek         *string
	Sections    json.RawMessage
	Model       string
	CreatedAt   time.Time
	UpdatedAt   time.Time
}

type GlobalUpsert struct {
	EditionDate string
	Language    string
	WindowStart time.Time
	WindowEnd   time.Time
	SignalCount int
	IsQuiet     bool
	TopAssets   json.RawMessage
	TopTags     json.RawMessage
	Headline    string
	Dek         string
	Sections    json.RawMessage
	Model       string
}

// GlobalExists — 调度器幂等判定: 该 edition_date 是否已有任意语言的底稿.
func (r *Repository) GlobalExists(ctx context.Context, editionDate string) (bool, error) {
	const q = `SELECT EXISTS(SELECT 1 FROM morning_report_globals WHERE edition_date = $1::date)`
	var ok bool
	if err := r.pool.QueryRow(ctx, q, editionDate).Scan(&ok); err != nil {
		return false, fmt.Errorf("global exists: %w", err)
	}
	return ok, nil
}

// UpsertGlobal — 写底稿. ON CONFLICT 覆盖 (调度器靠 GlobalExists 防重生成, 此处覆盖让 admin 可重刊).
func (r *Repository) UpsertGlobal(ctx context.Context, in GlobalUpsert) error {
	const q = `
		INSERT INTO morning_report_globals
			(edition_date, language, window_start, window_end, signal_count, is_quiet,
			 top_assets, top_tags, headline, dek, sections, model)
		VALUES ($1::date, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (edition_date, language) DO UPDATE SET
			window_start = EXCLUDED.window_start,
			window_end   = EXCLUDED.window_end,
			signal_count = EXCLUDED.signal_count,
			is_quiet     = EXCLUDED.is_quiet,
			top_assets   = EXCLUDED.top_assets,
			top_tags     = EXCLUDED.top_tags,
			headline     = EXCLUDED.headline,
			dek          = EXCLUDED.dek,
			sections     = EXCLUDED.sections,
			model        = EXCLUDED.model,
			updated_at   = now()
	`
	_, err := r.pool.Exec(ctx, q,
		in.EditionDate, in.Language, in.WindowStart, in.WindowEnd, in.SignalCount, in.IsQuiet,
		jsonbArg(in.TopAssets), jsonbArg(in.TopTags), nullStr(in.Headline), nullStr(in.Dek),
		jsonbArg(in.Sections), in.Model,
	)
	if err != nil {
		return fmt.Errorf("upsert global: %w", err)
	}
	return nil
}

// GetGlobalByDateLang — serving 读. 缺失 → ErrNotFound (服务层回退默认语言).
func (r *Repository) GetGlobalByDateLang(ctx context.Context, editionDate, lang string) (*Global, error) {
	const q = `
		SELECT to_char(edition_date,'YYYY-MM-DD'), language, signal_count, is_quiet,
		       top_assets, top_tags, headline, dek, sections, model, created_at, updated_at
		FROM morning_report_globals
		WHERE edition_date = $1::date AND language = $2
	`
	var g Global
	var topAssets, topTags, sections []byte
	err := r.pool.QueryRow(ctx, q, editionDate, lang).Scan(
		&g.EditionDate, &g.Language, &g.SignalCount, &g.IsQuiet,
		&topAssets, &topTags, &g.Headline, &g.Dek, &sections, &g.Model, &g.CreatedAt, &g.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get global: %w", err)
	}
	g.TopAssets = json.RawMessage(topAssets)
	g.TopTags = json.RawMessage(topTags)
	g.Sections = json.RawMessage(sections)
	return &g, nil
}

// LatestGlobalDate — 最近一期 edition_date (今天 08:00 前没今天的就回退昨天那期). 无任何期 → ErrNotFound.
func (r *Repository) LatestGlobalDate(ctx context.Context) (string, error) {
	const q = `SELECT to_char(max(edition_date),'YYYY-MM-DD') FROM morning_report_globals`
	var d *string
	if err := r.pool.QueryRow(ctx, q).Scan(&d); err != nil {
		return "", fmt.Errorf("latest global date: %w", err)
	}
	if d == nil {
		return "", ErrNotFound
	}
	return *d, nil
}

// ───── per-user 版 (morning_report_editions) ─────

type Edition struct {
	UserID         uuid.UUID
	EditionDate    string
	Language       string
	SectionOrder   json.RawMessage
	PersonalIntro  *string
	RelevantAssets json.RawMessage
	Model          string
	ReadAt         *time.Time
	// per-user 整份社论 (migration 036). IsPersonalized=true 时 Headline/Dek/Sections 有效;
	// false 时为回退路径 (服务层用全局底稿正文, 这三者留空).
	IsPersonalized bool
	SignalCount    int // 命中该用户的信号数 (安静提示判定)
	Headline       *string
	Dek            *string
	Sections       json.RawMessage
}

type EditionUpsert struct {
	UserID         uuid.UUID
	EditionDate    string
	Language       string
	SectionOrder   json.RawMessage
	PersonalIntro  *string
	RelevantAssets json.RawMessage
	Model          string
	IsPersonalized bool
	SignalCount    int
	Headline       *string
	Dek            *string
	Sections       json.RawMessage
}

func (r *Repository) GetEdition(ctx context.Context, userID uuid.UUID, editionDate string) (*Edition, error) {
	const q = `
		SELECT to_char(edition_date,'YYYY-MM-DD'), language, section_order, personal_intro,
		       relevant_assets, model, read_at, is_personalized, signal_count, headline, dek, sections
		FROM morning_report_editions
		WHERE user_id = $1 AND edition_date = $2::date
	`
	var e Edition
	e.UserID = userID
	var order, relevant, sections []byte
	err := r.pool.QueryRow(ctx, q, userID, editionDate).Scan(
		&e.EditionDate, &e.Language, &order, &e.PersonalIntro, &relevant, &e.Model, &e.ReadAt,
		&e.IsPersonalized, &e.SignalCount, &e.Headline, &e.Dek, &sections,
	)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, ErrNotFound
		}
		return nil, fmt.Errorf("get edition: %w", err)
	}
	e.SectionOrder = json.RawMessage(order)
	e.RelevantAssets = json.RawMessage(relevant)
	e.Sections = json.RawMessage(sections)
	return &e, nil
}

func (r *Repository) UpsertEdition(ctx context.Context, in EditionUpsert) error {
	const q = `
		INSERT INTO morning_report_editions
			(user_id, edition_date, language, section_order, personal_intro, relevant_assets, model,
			 is_personalized, signal_count, headline, dek, sections)
		VALUES ($1, $2::date, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
		ON CONFLICT (user_id, edition_date) DO UPDATE SET
			language        = EXCLUDED.language,
			section_order   = EXCLUDED.section_order,
			personal_intro  = EXCLUDED.personal_intro,
			relevant_assets = EXCLUDED.relevant_assets,
			model           = EXCLUDED.model,
			is_personalized = EXCLUDED.is_personalized,
			signal_count    = EXCLUDED.signal_count,
			headline        = EXCLUDED.headline,
			dek             = EXCLUDED.dek,
			sections        = EXCLUDED.sections,
			updated_at      = now()
	`
	_, err := r.pool.Exec(ctx, q,
		in.UserID, in.EditionDate, in.Language, jsonbArg(in.SectionOrder),
		in.PersonalIntro, jsonbArg(in.RelevantAssets), in.Model,
		in.IsPersonalized, in.SignalCount, in.Headline, in.Dek, jsonbArg(in.Sections),
	)
	if err != nil {
		return fmt.Errorf("upsert edition: %w", err)
	}
	return nil
}

// MarkRead — 置已读 (Phase 2 未读角标用). 仅在未读时写, 幂等.
func (r *Repository) MarkRead(ctx context.Context, userID uuid.UUID, editionDate string) error {
	const q = `
		UPDATE morning_report_editions SET read_at = now(), updated_at = now()
		WHERE user_id = $1 AND edition_date = $2::date AND read_at IS NULL
	`
	if _, err := r.pool.Exec(ctx, q, userID, editionDate); err != nil {
		return fmt.Errorf("mark read: %w", err)
	}
	return nil
}

// jsonbArg — nil/空 RawMessage → "[]" (列默认), 否则原样 []byte (pgx jsonb codec 接受 raw JSON).
func jsonbArg(raw json.RawMessage) []byte {
	if len(raw) == 0 {
		return []byte("[]")
	}
	return []byte(raw)
}

func nullStr(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
