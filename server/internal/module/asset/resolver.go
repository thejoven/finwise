// Package asset 是「标的追踪」P0 · 标的归一 (symbol resolution).
//
// 把信号派生的自由文本标的 (signals.inference_related_assets[].ticker —— LLM 自由产出,
// "宁德时代" / "300750" / "NVDA" / "0700.HK" / "国内存储模组厂" 混杂) 归一到行情源认得的
// {规范代码, 交易所, 市场}, 落进 assets 注册表 + asset_aliases 别名表, 并为信号写
// signal_assets 链接 (冻结锚点 anchor_at = signal.captured_at).
//
// 归一顺序 (resolveReference):
//  1. asset_aliases 命中 → 直接复用, 省 LLM (§7 全局去重).
//  2. 规则: 纯数字 A股(6位) / 港股(4-5位) 代码、括号内嵌代码 —— 确定性, 不调 LLM.
//  3. (可选) Mastra symbol-resolver: 规则啃不动的中文名 / 裸字母 ticker / 模糊板块.
//  4. 诚实兜底: 归一不了一律 status='untrackable' —— 宁可留空也不模糊匹配凑一个可能错的代码
//     (§7 / 呼应"信号永不未分类"式诚实兜底). 加密 / 未上市 / 海外主上市 / 篮子都落这里.
//
// 派生 / 缓存数据, 不写 events (同 distillations / subscriptions 先例).
package asset

import (
	"context"
	"fmt"
	"regexp"
	"strings"

	"github.com/google/uuid"
	"go.uber.org/zap"

	"wiseflow/server/internal/infra/mastra"
)

// market 取值.
const (
	MarketA     = "a"
	MarketHK    = "hk"
	MarketUS    = "us"
	MarketOther = "other" // untrackable 专用: 非 A/HK/US (crypto / 未上市 / 海外 / 篮子).
)

// status 取值.
const (
	StatusActive      = "active"
	StatusDelisted    = "delisted"
	StatusUntrackable = "untrackable"
)

// resolution 是一次归一的中间结果 (尚未落库). Source/Reason 仅作诊断/统计.
type resolution struct {
	Canonical      string
	Exchange       string
	Market         string
	Name           string
	ProviderSymbol string
	Type           string
	Status         string // active | untrackable
	Source         string // alias | rule | llm | no-llm | manual
	Reason         string // untrackable 时的原因 (加密 / 未上市 / …)
}

func (r resolution) untrackable() bool { return r.Status == StatusUntrackable }

// ───────────────────────── 规则层 (确定性, 不调 LLM) ─────────────────────────

var (
	reAShareBare   = regexp.MustCompile(`^\d{6}$`)
	reAShareSuffix = regexp.MustCompile(`^(\d{6})\.(S[ZHS]|BJ)$`) // .SZ/.SH/.SS/.BJ
	reHKBare       = regexp.MustCompile(`^\d{4,5}$`)
	reHKSuffix     = regexp.MustCompile(`^(\d{1,5})\.HK$`)
	reParen        = regexp.MustCompile(`[（(]\s*([^（）()]+?)\s*[）)]`) // 取括号内容 (全/半角)
	reSpaces       = regexp.MustCompile(`\s+`)

	// LLM/人工输出的结构校验 (代码格式须与 market 匹配, 兜住格式型幻觉).
	reCodeA  = regexp.MustCompile(`^\d{6}$`)
	reCodeHK = regexp.MustCompile(`^\d{1,5}$`)
	reCodeUS = regexp.MustCompile(`^[A-Za-z][A-Za-z.\-]{0,6}$`)
)

// normalizeAlias 归一化别名 key: trim + 折叠内部空白 + 转小写. 用作 asset_aliases.alias_lower.
func normalizeAlias(reference string) string {
	s := reSpaces.ReplaceAllString(strings.TrimSpace(reference), " ")
	return strings.ToLower(s)
}

// classifyByRule 用确定性规则归一. 只认数字代码 (整体 / 括号内嵌); 裸字母 (美股 ticker /
// 加密 / 公司名) 一律交给 LLM —— 规则分不清 "BTC"(加密) 与 "AMD"(美股), 不在规则层猜.
// 返回 nil = 规则啃不动.
func classifyByRule(reference string) *resolution {
	ref := strings.TrimSpace(reference)
	if r := classifyCode(ref); r != nil {
		return r
	}
	// 括号内嵌代码: "泡泡玛特 (9992.HK)" / "安集科技 (688019.SH)" / "鼎龙股份 (300054.SZ)".
	if m := reParen.FindStringSubmatch(ref); m != nil {
		if r := classifyCode(strings.TrimSpace(m[1])); r != nil {
			if name := strings.TrimSpace(reParen.ReplaceAllString(ref, "")); name != "" {
				r.Name = name // 括号前的名字更可读
			}
			return r
		}
	}
	return nil
}

// classifyCode 把一个"看起来像代码"的 token 归一为 A股/港股. 非数字代码 → nil.
func classifyCode(token string) *resolution {
	t := strings.ToUpper(strings.TrimSpace(token))
	switch {
	case t == "":
		return nil
	case reAShareSuffix.MatchString(t):
		return aShare(reAShareSuffix.FindStringSubmatch(t)[1])
	case reHKSuffix.MatchString(t):
		return hkShare(reHKSuffix.FindStringSubmatch(t)[1])
	case reAShareBare.MatchString(t): // 裸 6 位 → A股
		return aShare(t)
	case reHKBare.MatchString(t): // 裸 4-5 位 → 港股 (A股恒为 6 位, 不冲突)
		return hkShare(t)
	default:
		return nil
	}
}

// aShare 由 6 位代码首位判交易所 (首位比来源后缀更可靠): 6/9→沪, 0/2/3→深, 4/8→北.
func aShare(code string) *resolution {
	ex, suf := "SSE", ".SH"
	switch code[0] {
	case '0', '2', '3':
		ex, suf = "SZSE", ".SZ"
	case '4', '8':
		ex, suf = "BSE", ".BJ"
	}
	return &resolution{
		Canonical: code, Exchange: ex, Market: MarketA, Name: code,
		ProviderSymbol: code + suf, Type: "equity", Status: StatusActive, Source: "rule",
	}
}

// hkShare 港股代码补零到 5 位 (0700 → 00700).
func hkShare(code string) *resolution {
	for len(code) < 5 {
		code = "0" + code
	}
	return &resolution{
		Canonical: code, Exchange: "HKEX", Market: MarketHK, Name: code,
		ProviderSymbol: code + ".HK", Type: "equity", Status: StatusActive, Source: "rule",
	}
}

// resolutionFromLLM 把 Mastra 输出转 resolution; 结构校验失败 (代码格式与 market 不符)
// 返回 nil → 调用方当 untrackable, 兜住格式型幻觉.
func resolutionFromLLM(r *mastra.SymbolResolveResponse) *resolution {
	if r == nil || !r.Resolvable {
		return nil
	}
	sym := strings.TrimSpace(r.Symbol)
	if sym == "" {
		return nil
	}
	var res *resolution
	switch strings.ToLower(strings.TrimSpace(r.Market)) {
	case MarketA:
		if !reCodeA.MatchString(sym) {
			return nil
		}
		res = aShare(sym)
	case MarketHK:
		if !reCodeHK.MatchString(sym) {
			return nil
		}
		res = hkShare(sym)
	case MarketUS:
		c := strings.ToUpper(sym)
		if !reCodeUS.MatchString(c) {
			return nil
		}
		res = &resolution{
			Canonical: c, Market: MarketUS, Name: c,
			ProviderSymbol: c, Type: "equity", Status: StatusActive,
		}
	default:
		return nil
	}
	res.Source = "llm"
	if e := strings.ToUpper(strings.TrimSpace(r.Exchange)); e != "" {
		res.Exchange = e
	}
	if n := strings.TrimSpace(r.Name); n != "" {
		res.Name = n
	}
	if t := strings.TrimSpace(r.Type); t != "" {
		res.Type = t
	}
	return res
}

// untrackableRes 构造不可追踪占位. canonical = 归一化别名 (保证 UNIQUE(market,canonical) 不撞),
// market='other'. 诚实兜底 (§7): 宁可留空也不追错.
func untrackableRes(reference, reason, source string) *resolution {
	name := strings.TrimSpace(reference)
	if name == "" {
		name = "(unknown)"
	}
	return &resolution{
		Canonical: normalizeAlias(reference), Exchange: "", Market: MarketOther,
		Name: name, Type: "other", Status: StatusUntrackable, Source: source, Reason: reason,
	}
}

// ───────────────────────── 归一编排 (调 LLM + 落库) ─────────────────────────

// resolveReference 把一条自由文本指称归一到一个 asset, upsert assets/asset_aliases, 返回 asset_id.
// contextText (信号 rationale / 原文) 透传给 LLM 帮助消歧. 命中别名缓存时不再 upsert.
func (s *Service) resolveReference(ctx context.Context, reference, contextText string) (uuid.UUID, *resolution, error) {
	alias := normalizeAlias(reference)
	if alias == "" {
		return uuid.Nil, nil, ErrEmptyReference
	}

	// 1) 别名缓存
	if id, ok, err := s.repo.LookupAlias(ctx, alias); err != nil {
		return uuid.Nil, nil, err
	} else if ok {
		return id, &resolution{Source: "alias"}, nil
	}

	// 2) 规则
	res := classifyByRule(reference)

	// 3) LLM (规则啃不动 且 Mastra 可用)
	if res == nil {
		if s.mastra.IsConfigured() {
			resp, err := s.mastra.ResolveSymbol(ctx, mastra.SymbolResolveRequest{
				Reference: reference, Context: contextText,
			})
			if err != nil {
				// 调用失败是瞬时的: 不缓存别名、不硬猜 → 留给重跑 / 人工兜底. 上抛让调用方记账.
				return uuid.Nil, nil, fmt.Errorf("resolve %q via mastra: %w", reference, err)
			}
			if r := resolutionFromLLM(resp); r != nil {
				res = r
			} else {
				reason := "无法归一"
				if resp != nil && resp.Reason != "" {
					reason = resp.Reason
				}
				res = untrackableRes(reference, reason, "llm")
			}
		} else {
			res = untrackableRes(reference, "归一服务未配置", "no-llm")
		}
	}

	// 4) 落库
	id, err := s.repo.UpsertAsset(ctx, *res)
	if err != nil {
		return uuid.Nil, nil, err
	}
	if err := s.repo.UpsertAlias(ctx, alias, id); err != nil {
		return uuid.Nil, nil, err
	}
	return id, res, nil
}

// ───────────────────────── 一次性 backfill ─────────────────────────

// BackfillStats 是存量回填的统计 (供人工判断命中率, DoD ③).
type BackfillStats struct {
	Signals      int
	Refs         int
	AliasHits    int
	RuleResolved int
	LLMResolved  int
	Untrackable  int
	Errors       int
}

// Backfill 把存量 signals.inference_related_assets 全跑一遍 resolver, 落 assets / signal_assets.
// 幂等: asset 按 (market,canonical) upsert, signal_assets ON CONFLICT DO NOTHING (锚点不被覆盖).
func (s *Service) Backfill(ctx context.Context) (*BackfillStats, error) {
	rows, err := s.repo.SignalsWithAssets(ctx)
	if err != nil {
		return nil, err
	}
	st := &BackfillStats{}
	for _, sig := range rows {
		st.Signals++
		for _, ra := range sig.Assets {
			ref := strings.TrimSpace(ra.Ticker)
			if ref == "" {
				continue
			}
			st.Refs++
			id, res, err := s.resolveReference(ctx, ref, ra.Rationale)
			if err != nil {
				st.Errors++
				s.logger.Warn("backfill resolve failed", zap.String("ref", ref), zap.Error(err))
				continue
			}
			switch {
			case res.Source == "alias":
				st.AliasHits++
			case res.untrackable():
				st.Untrackable++
			case res.Source == "rule":
				st.RuleResolved++
			default: // llm
				st.LLMResolved++
			}
			if err := s.repo.LinkSignalAsset(ctx, sig.ID, id, ra.Rationale, sig.CapturedAt); err != nil {
				st.Errors++
				s.logger.Warn("backfill link failed",
					zap.String("signal", sig.ID.String()), zap.String("ref", ref), zap.Error(err))
			}
		}
	}
	return st, nil
}
