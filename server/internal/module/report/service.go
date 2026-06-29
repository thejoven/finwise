package report

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"alphax/server/internal/infra/mastra"
)

// 支持的语言 (与 users.language / migration 023 对齐). 全局底稿每天每语言各生成一份.
var languages = []string{"zh-Hans", "zh-Hant", "en"}

const defaultLanguage = "zh-Hans"

// Deps — 个性化所需的跨模块只读闭包 (main.go 注入, 避免 report 反向 import asset/project/account).
type Deps struct {
	// TrackedAssets 返回用户关注标的的匹配 token (canonical + name).
	TrackedAssets func(ctx context.Context, userID uuid.UUID) ([]string, error)
	// ActiveThemes 返回用户活跃分类的匹配 token (name + guidance); 仅内部重排用, 绝不出参 (含个人信息).
	ActiveThemes func(ctx context.Context, userID uuid.UUID) ([]string, error)
	// UserLanguage 返回用户语言偏好 ("" = 用默认).
	UserLanguage func(ctx context.Context, userID uuid.UUID) (string, error)
}

type ServiceConfig struct {
	MinAssets int            // 低于此信号量 → 安静日短版
	KAnon     int            // k-匿名 cohort 下限 (<K 的摘要不送 LLM); 默认 3
	Loc       *time.Location // edition 窗口计算时区
}

type Service struct {
	repo   *Repository
	mastra *mastra.Client
	deps   Deps
	cfg    ServiceConfig
	logger *zap.Logger
}

func NewService(repo *Repository, mastraClient *mastra.Client, deps Deps, cfg ServiceConfig, logger *zap.Logger) *Service {
	if cfg.KAnon <= 0 {
		cfg.KAnon = 3
	}
	if cfg.Loc == nil {
		cfg.Loc = time.UTC
	}
	return &Service{repo: repo, mastra: mastraClient, deps: deps, cfg: cfg, logger: logger}
}

// GlobalDigestExists — 调度器幂等判定.
func (s *Service) GlobalDigestExists(ctx context.Context, editionDate string) (bool, error) {
	return s.repo.GlobalExists(ctx, editionDate)
}

// GenerateForEditionDate — 按 edition_date (当地日历日) 算出"前一天"窗口并生成全局底稿.
// 供调度器 (今天) 与 admin 手动重刊/补刊共用.
func (s *Service) GenerateForEditionDate(ctx context.Context, editionDate string) error {
	windowStart, windowEnd, err := s.windowForEditionDate(editionDate)
	if err != nil {
		return err
	}
	return s.GenerateGlobal(ctx, editionDate, windowStart, windowEnd)
}

// GenerateGlobal — 聚合 → k-匿名 → 按语言生成共享社论 (Mastra 不可用则 Go 兜底) → 落库.
func (s *Service) GenerateGlobal(ctx context.Context, editionDate string, start, end time.Time) error {
	agg, err := s.repo.AggregateWindow(ctx, start, end)
	if err != nil {
		return fmt.Errorf("aggregate: %w", err)
	}

	isQuiet := agg.SignalCount < s.cfg.MinAssets || len(agg.TopAssets) == 0

	// k-匿名: 只把 signal_count >= K 的标的 cohort 的摘要交给 LLM, 防单用户笔记被反推/近似逐字引用.
	allowed := make(map[string]bool, len(agg.TopAssets))
	for _, a := range agg.TopAssets {
		if a.SignalCount >= s.cfg.KAnon {
			allowed[strings.ToLower(strings.TrimSpace(a.Ticker))] = true
		}
	}
	var safeSummaries []mastra.ReportAssetNote
	for _, n := range agg.Summaries {
		if allowed[strings.ToLower(strings.TrimSpace(n.Ticker))] {
			safeSummaries = append(safeSummaries, mastra.ReportAssetNote{Ticker: n.Ticker, Summary: n.Summary})
		}
	}

	topAssetsJSON := assetsToJSON(agg.TopAssets)
	topTagsJSON := tagsToJSON(agg.TopTags)
	mastraAssets := toMastraAssets(agg.TopAssets)
	mastraTags := toMastraTags(agg.TopTags)

	for _, lang := range languages {
		req := mastra.MorningReportRequest{
			Language:  lang,
			TopAssets: mastraAssets,
			TopTags:   mastraTags,
			Summaries: safeSummaries,
			IsQuiet:   isQuiet,
		}
		headline, dek, sections, model := s.composeEditorial(ctx, req, agg)
		secJSON, err := json.Marshal(coerceSections(sections))
		if err != nil {
			return fmt.Errorf("marshal sections: %w", err)
		}
		if err := s.repo.UpsertGlobal(ctx, GlobalUpsert{
			EditionDate: editionDate,
			Language:    lang,
			WindowStart: start,
			WindowEnd:   end,
			SignalCount: agg.SignalCount,
			IsQuiet:     isQuiet,
			TopAssets:   topAssetsJSON,
			TopTags:     topTagsJSON,
			Headline:    headline,
			Dek:         dek,
			Sections:    secJSON,
			Model:       model,
		}); err != nil {
			return fmt.Errorf("upsert global %s: %w", lang, err)
		}
	}
	return nil
}

// composeEditorial — 调 Mastra 写社论; 不可用/出错/空结果 → Go 确定性兜底 (从 top tags/assets 拼).
func (s *Service) composeEditorial(ctx context.Context, req mastra.MorningReportRequest, agg Aggregate) (string, string, []mastra.MorningReportSection, string) {
	resp, err := s.mastra.MorningReport(ctx, req)
	if err != nil || resp == nil || len(resp.Sections) == 0 {
		if err != nil && !errors.Is(err, mastra.ErrNotConfigured) {
			s.logger.Warn("morning report mastra failed; using fallback",
				zap.String("lang", req.Language), zap.Error(err))
		}
		h, d, secs := fallbackEditorial(req.Language, agg, req.IsQuiet)
		return h, d, secs, "fallback"
	}
	return resp.Headline, resp.Dek, resp.Sections, "mastra"
}

// ───── serving (懒加载个性化) ─────

type UserReportView struct {
	Available      bool
	EditionDate    string
	Language       string
	IsQuiet        bool
	SignalCount    int
	Headline       *string
	Dek            *string
	Sections       []mastra.MorningReportSection
	SectionOrder   []string
	PersonalIntro  *string
	RelevantAssets []mastra.ReportPersonalAsset
	TopAssets      json.RawMessage
	TopTags        json.RawMessage
	ReadAt         *time.Time
}

// GetForUser — 早报读取入口. 解析语言+日期 → 读全局底稿 (缺该语言回退默认) → 命中 edition
// 缓存即返回; 未命中则纯 Go 重排 + (有重叠时) 一次小 LLM 写"为你导读", 写缓存后返回.
// 无任何底稿 → ErrNotFound (handler 返回空态).
func (s *Service) GetForUser(ctx context.Context, userID uuid.UUID, dateOpt string) (*UserReportView, error) {
	lang := defaultLanguage
	if s.deps.UserLanguage != nil {
		if l, err := s.deps.UserLanguage(ctx, userID); err == nil && l != "" {
			lang = l
		}
	}

	date := dateOpt
	if date == "" {
		d, err := s.repo.LatestGlobalDate(ctx)
		if err != nil {
			return nil, err // ErrNotFound 或真错
		}
		date = d
	}

	global, err := s.repo.GetGlobalByDateLang(ctx, date, lang)
	if errors.Is(err, ErrNotFound) && lang != defaultLanguage {
		global, err = s.repo.GetGlobalByDateLang(ctx, date, defaultLanguage)
	}
	if err != nil {
		return nil, err
	}

	var sections []mastra.MorningReportSection
	_ = json.Unmarshal(global.Sections, &sections)

	view := &UserReportView{
		Available:   true,
		EditionDate: global.EditionDate,
		Language:    global.Language,
		IsQuiet:     global.IsQuiet,
		SignalCount: global.SignalCount,
		Headline:    global.Headline,
		Dek:         global.Dek,
		Sections:    sections,
		TopAssets:   global.TopAssets,
		TopTags:     global.TopTags,
	}

	// 命中 per-user 缓存?
	ed, err := s.repo.GetEdition(ctx, userID, date)
	if err == nil {
		applyEdition(view, ed)
		return view, nil
	}
	if !errors.Is(err, ErrNotFound) {
		return nil, err
	}

	// 未命中 → 懒加载: 尝试整份 per-user 社论, 否则回退全局底稿. 写缓存后应用到 view.
	up := s.buildEdition(ctx, userID, date, global, sections)
	if err := s.repo.UpsertEdition(ctx, up); err != nil {
		// 缓存写失败不阻塞返回 (下次再算).
		s.logger.Warn("upsert edition failed (ignored)", zap.Error(err))
	}
	applyUpsert(view, up)
	return view, nil
}

// buildEdition — 未命中缓存时构建 per-user 版. 三档 (成本递增):
//  1. 无任何关注 token → 回退全局底稿 (原序, 无 LLM).
//  2. 有关注但昨日命中信号 < MinAssets (你的盘面安静) → 廉价回退: 按 token 重排全局板块 + 一句静态提示 (无 LLM).
//  3. 命中信号充足 → 调 LLM 写整份个性化简报 (每用户每天 1 次, 懒加载已封顶成本).
//
// 任一上游失败 (窗口解析 / 聚合 / LLM) 都降级到更便宜的档, tab 永不空.
func (s *Service) buildEdition(ctx context.Context, userID uuid.UUID, date string, global *Global, globalSections []mastra.MorningReportSection) EditionUpsert {
	up := EditionUpsert{
		UserID:         userID,
		EditionDate:    date,
		Language:       global.Language,
		SectionOrder:   mustJSON(sectionIDs(globalSections)),
		RelevantAssets: json.RawMessage("[]"),
		Sections:       json.RawMessage("[]"),
	}

	var tracked, themes []string
	if s.deps.TrackedAssets != nil {
		tracked, _ = s.deps.TrackedAssets(ctx, userID)
	}
	if s.deps.ActiveThemes != nil {
		themes, _ = s.deps.ActiveThemes(ctx, userID)
	}

	// 档1: 无任何关注 → 全局原序.
	if len(tracked) == 0 && len(themes) == 0 {
		return up
	}

	// 全局安静日 / 无板块: 没素材可个性化, 重排(identity)即可.
	if global.IsQuiet || len(globalSections) == 0 {
		order, _ := reorderSections(globalSections, tracked, themes)
		up.SectionOrder = mustJSON(order)
		return up
	}

	start, end, err := s.windowForEditionDate(date)
	if err != nil {
		s.logger.Warn("window parse failed; global fallback", zap.Error(err))
		return up
	}
	agg, err := s.repo.AggregateWindowForUser(ctx, start, end, tracked, themes)
	if err != nil {
		s.logger.Warn("user aggregate failed; reorder fallback", zap.Error(err))
		order, _ := reorderSections(globalSections, tracked, themes)
		up.SectionOrder = mustJSON(order)
		return up
	}
	up.SignalCount = agg.SignalCount

	// 档2: 你关注的标的昨日较安静 → 廉价重排 + 静态提示, 不调 LLM.
	if agg.SignalCount < s.cfg.MinAssets || len(agg.TopAssets) == 0 {
		order, _ := reorderSections(globalSections, tracked, themes)
		up.SectionOrder = mustJSON(order)
		note := quietPersonalNote(global.Language)
		up.PersonalIntro = &note
		return up
	}

	// 档3: 整份 per-user 社论.
	resp, model := s.composeForUser(ctx, global.Language, tracked, agg)
	if resp == nil || len(resp.Sections) == 0 {
		// LLM 失败 → 廉价重排兜底.
		order, _ := reorderSections(globalSections, tracked, themes)
		up.SectionOrder = mustJSON(order)
		return up
	}
	secJSON, err := json.Marshal(coerceSections(resp.Sections))
	if err != nil {
		order, _ := reorderSections(globalSections, tracked, themes)
		up.SectionOrder = mustJSON(order)
		return up
	}
	headline, dek := resp.Headline, resp.Dek
	up.IsPersonalized = true
	up.Headline = &headline
	up.Dek = &dek
	up.Sections = secJSON
	up.SectionOrder = mustJSON(sectionIDs(resp.Sections))
	up.RelevantAssets = mustJSON(relevantFromAssets(global.Language, agg.TopAssets))
	up.Model = model
	return up
}

// composeForUser — k-匿名过滤后调 LLM 写整份个性化社论. 失败返回 (nil,"") 让上层降级.
func (s *Service) composeForUser(ctx context.Context, lang string, tracked []string, agg Aggregate) (*mastra.MorningReportResponse, string) {
	// k-匿名: 同全局路径, 仅放行 signal_count >= K 的标的摘要 (per-user 过滤不放松此口径).
	allowed := make(map[string]bool, len(agg.TopAssets))
	for _, a := range agg.TopAssets {
		if a.SignalCount >= s.cfg.KAnon {
			allowed[strings.ToLower(strings.TrimSpace(a.Ticker))] = true
		}
	}
	var safe []mastra.ReportAssetNote
	for _, n := range agg.Summaries {
		if allowed[strings.ToLower(strings.TrimSpace(n.Ticker))] {
			safe = append(safe, mastra.ReportAssetNote{Ticker: n.Ticker, Summary: n.Summary})
		}
	}
	resp, err := s.mastra.MorningReportForUser(ctx, mastra.MorningReportForUserRequest{
		Language:      lang,
		TrackedTokens: tracked,
		TopAssets:     toMastraAssets(agg.TopAssets),
		TopTags:       toMastraTags(agg.TopTags),
		Summaries:     safe,
		IsQuiet:       false,
	})
	if err != nil {
		if !errors.Is(err, mastra.ErrNotConfigured) {
			s.logger.Warn("morning report for-you mastra failed; fallback", zap.Error(err))
		}
		return nil, ""
	}
	return resp, "mastra"
}

// windowForEditionDate — edition_date (当地日历日) → 前一天 [00:00,24:00) 当地窗口.
func (s *Service) windowForEditionDate(editionDate string) (time.Time, time.Time, error) {
	d, err := time.ParseInLocation("2006-01-02", editionDate, s.cfg.Loc)
	if err != nil {
		return time.Time{}, time.Time{}, fmt.Errorf("bad edition_date %q: %w", editionDate, err)
	}
	windowEnd := time.Date(d.Year(), d.Month(), d.Day(), 0, 0, 0, 0, s.cfg.Loc)
	windowStart := windowEnd.AddDate(0, 0, -1)
	return windowStart, windowEnd, nil
}

// MarkRead — 透传.
func (s *Service) MarkRead(ctx context.Context, userID uuid.UUID, editionDate string) error {
	return s.repo.MarkRead(ctx, userID, editionDate)
}

// ───── 个性化重排打分 ─────

// tokenMatch — 双向子串匹配 (大小写不敏感), 容忍 "NVDA"↔"英伟达 NVDA"、"光伏"↔"光伏产业链".
func tokenMatch(a, b string) bool {
	la := strings.ToLower(strings.TrimSpace(a))
	lb := strings.ToLower(strings.TrimSpace(b))
	if la == "" || lb == "" {
		return false
	}
	return strings.Contains(la, lb) || strings.Contains(lb, la)
}

func scoreSection(sec mastra.MorningReportSection, tracked, themes []string) int {
	score := 0
	for _, a := range sec.Assets {
		for _, t := range tracked {
			if tokenMatch(a, t) {
				score++
				break
			}
		}
	}
	for _, tg := range sec.Tags {
		for _, th := range themes {
			if tokenMatch(tg, th) {
				score++
				break
			}
		}
	}
	return score
}

// reorderSections — 按与用户重叠分稳定降序 (同分保留原序), 返回 section_id 顺序 + 最高分.
func reorderSections(sections []mastra.MorningReportSection, tracked, themes []string) ([]string, int) {
	type sc struct {
		idx, score int
	}
	scored := make([]sc, len(sections))
	maxScore := 0
	for i, sec := range sections {
		v := scoreSection(sec, tracked, themes)
		scored[i] = sc{idx: i, score: v}
		if v > maxScore {
			maxScore = v
		}
	}
	sort.SliceStable(scored, func(i, j int) bool { return scored[i].score > scored[j].score })
	order := make([]string, 0, len(sections))
	for _, s := range scored {
		order = append(order, sections[s.idx].ID)
	}
	return order, maxScore
}

// ───── helpers ─────

func applyEdition(view *UserReportView, ed *Edition) {
	var order []string
	_ = json.Unmarshal(ed.SectionOrder, &order)
	view.SectionOrder = order
	view.PersonalIntro = ed.PersonalIntro
	var relevant []mastra.ReportPersonalAsset
	_ = json.Unmarshal(ed.RelevantAssets, &relevant)
	view.RelevantAssets = relevant
	view.ReadAt = ed.ReadAt
	applyPersonalEditorial(view, ed.IsPersonalized, ed.Headline, ed.Dek, ed.Sections)
}

// applyUpsert — 把刚构建的 EditionUpsert 应用到 view (免去 upsert 后再 GetEdition 一次).
func applyUpsert(view *UserReportView, up EditionUpsert) {
	var order []string
	_ = json.Unmarshal(up.SectionOrder, &order)
	view.SectionOrder = order
	view.PersonalIntro = up.PersonalIntro
	var relevant []mastra.ReportPersonalAsset
	_ = json.Unmarshal(up.RelevantAssets, &relevant)
	view.RelevantAssets = relevant
	applyPersonalEditorial(view, up.IsPersonalized, up.Headline, up.Dek, up.Sections)
}

// applyPersonalEditorial — 个性化档把 view 的正文 (headline/dek/sections) 整份替换为 per-user 版.
func applyPersonalEditorial(view *UserReportView, personalized bool, headline, dek *string, sectionsJSON json.RawMessage) {
	if !personalized {
		return
	}
	var secs []mastra.MorningReportSection
	if err := json.Unmarshal(sectionsJSON, &secs); err == nil && len(secs) > 0 {
		view.Sections = secs
	}
	if headline != nil {
		view.Headline = headline
	}
	if dek != nil {
		view.Dek = dek
	}
	view.IsQuiet = false
}

func sectionIDs(sections []mastra.MorningReportSection) []string {
	out := make([]string, 0, len(sections))
	for _, sec := range sections {
		out = append(out, sec.ID)
	}
	return out
}

// quietPersonalNote — 档2 (你关注的标的昨日安静) 的静态导读, 复用 personal_intro 渲染.
func quietPersonalNote(lang string) string {
	switch lang {
	case "zh-Hant":
		return "你關注的標的昨日較為安靜，先為你帶來全站概覽。"
	case "en":
		return "Your watchlist was quiet yesterday — here's the platform-wide overview for now."
	default:
		return "你关注的标的昨日较为安静，先为你带来全站概览。"
	}
}

// relevantFromAssets — 个性化档把命中用户关注的标的 (附信号数) 作为"与你相关"标的回带给前端.
func relevantFromAssets(lang string, assets []AssetStat) []mastra.ReportPersonalAsset {
	out := make([]mastra.ReportPersonalAsset, 0, 8)
	for _, a := range assets {
		if len(out) >= 8 {
			break
		}
		out = append(out, mastra.ReportPersonalAsset{Ticker: a.Ticker, Reason: relevantReason(lang, a.SignalCount)})
	}
	return out
}

func relevantReason(lang string, n int) string {
	switch lang {
	case "en":
		return fmt.Sprintf("%d related signals yesterday", n)
	case "zh-Hant":
		return fmt.Sprintf("昨日 %d 條相關信號", n)
	default:
		return fmt.Sprintf("昨日 %d 条相关信号", n)
	}
}

func coerceSections(in []mastra.MorningReportSection) []mastra.MorningReportSection {
	if in == nil {
		return []mastra.MorningReportSection{}
	}
	for i := range in {
		if in[i].Assets == nil {
			in[i].Assets = []string{}
		}
		if in[i].Tags == nil {
			in[i].Tags = []string{}
		}
	}
	return in
}

func toMastraAssets(in []AssetStat) []mastra.ReportAssetStat {
	out := make([]mastra.ReportAssetStat, 0, len(in))
	for _, a := range in {
		out = append(out, mastra.ReportAssetStat{Ticker: a.Ticker, Mentions: a.Mentions, SignalCount: a.SignalCount})
	}
	return out
}

func toMastraTags(in []TagStat) []mastra.ReportTagStat {
	out := make([]mastra.ReportTagStat, 0, len(in))
	for _, t := range in {
		out = append(out, mastra.ReportTagStat{Tag: t.Tag, Mentions: t.Mentions, SignalCount: t.SignalCount})
	}
	return out
}

func assetsToJSON(in []AssetStat) json.RawMessage {
	type row struct {
		Ticker      string `json:"ticker"`
		Mentions    int    `json:"mentions"`
		SignalCount int    `json:"signal_count"`
	}
	out := make([]row, 0, len(in))
	for _, a := range in {
		out = append(out, row{Ticker: a.Ticker, Mentions: a.Mentions, SignalCount: a.SignalCount})
	}
	b, _ := json.Marshal(out)
	return b
}

func tagsToJSON(in []TagStat) json.RawMessage {
	type row struct {
		Tag         string `json:"tag"`
		Mentions    int    `json:"mentions"`
		SignalCount int    `json:"signal_count"`
	}
	out := make([]row, 0, len(in))
	for _, t := range in {
		out = append(out, row{Tag: t.Tag, Mentions: t.Mentions, SignalCount: t.SignalCount})
	}
	b, _ := json.Marshal(out)
	return b
}

func mustJSON(v any) json.RawMessage {
	b, err := json.Marshal(v)
	if err != nil {
		return json.RawMessage("[]")
	}
	return b
}
