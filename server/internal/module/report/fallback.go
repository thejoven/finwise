package report

import (
	"fmt"
	"strings"

	"alphax/server/internal/infra/mastra"
)

// fallbackEditorial — Mastra 不可用/出错时的确定性兜底社论, 从聚合统计直接拼.
// 克制、只陈述事实 (不预测、不荐股), 保证早报 tab 永不空白. 三语各一套文案.
func fallbackEditorial(lang string, agg Aggregate, isQuiet bool) (string, string, []mastra.MorningReportSection) {
	t, ok := fbStringsByLang[lang]
	if !ok {
		t = fbStringsByLang[defaultLanguage]
	}

	if isQuiet {
		return t.quietHeadline, t.quietDek, []mastra.MorningReportSection{{
			ID:      "quiet",
			Heading: t.quietHeadline,
			Body:    t.quietBody,
			Assets:  []string{},
			Tags:    []string{},
		}}
	}

	sections := make([]mastra.MorningReportSection, 0, 2)

	// 概览: 最受关注标签.
	tagList := make([]string, 0, 8)
	for i, tg := range agg.TopTags {
		if i >= 8 {
			break
		}
		tagList = append(tagList, tg.Tag)
	}
	overviewBody := fmt.Sprintf(t.overviewIntro, agg.SignalCount)
	if len(tagList) > 0 {
		overviewBody += t.themeJoin + strings.Join(tagList, t.listSep)
	}
	sections = append(sections, mastra.MorningReportSection{
		ID:      "overview",
		Heading: t.overviewHeading,
		Body:    overviewBody,
		Assets:  []string{},
		Tags:    tagList,
	})

	// 标的观察: 最受关注标的 + 信号数.
	lines := make([]string, 0, 8)
	tickers := make([]string, 0, 8)
	for i, a := range agg.TopAssets {
		if i >= 8 {
			break
		}
		lines = append(lines, fmt.Sprintf(t.assetLineFmt, a.Ticker, t.signalsLabel, a.SignalCount))
		tickers = append(tickers, a.Ticker)
	}
	if len(lines) > 0 {
		sections = append(sections, mastra.MorningReportSection{
			ID:      "assets",
			Heading: t.assetsHeading,
			Body:    strings.Join(lines, "\n"),
			Assets:  tickers,
			Tags:    []string{},
		})
	}

	return t.headline, t.dek, sections
}

type fbStrings struct {
	quietHeadline   string
	quietDek        string
	quietBody       string
	headline        string
	dek             string
	overviewHeading string
	overviewIntro   string // 含一个 %d (信号数)
	themeJoin       string // 概览句与标签列表之间的连接
	listSep         string // 标签分隔符
	assetsHeading   string
	signalsLabel    string
	assetLineFmt    string // 含 %s(ticker) %s(label) %d(count)
}

var fbStringsByLang = map[string]fbStrings{
	"zh-Hans": {
		quietHeadline:   "昨日信号稀少",
		quietDek:        "市场平静的一天",
		quietBody:       "昨日全平台转为信号的内容不多，没有形成明显的主题或标的热点。安静也是一种信息——不必为没有行情而焦虑。",
		headline:        "昨日市场关注",
		dek:             "来自全平台信号的去标识化综述",
		overviewHeading: "今日概览",
		overviewIntro:   "昨日全平台共收录 %d 条信号。",
		themeJoin:       "最受关注的主题：",
		listSep:         "、",
		assetsHeading:   "标的观察",
		signalsLabel:    "信号",
		assetLineFmt:    "%s（%s %d）",
	},
	"zh-Hant": {
		quietHeadline:   "昨日訊號稀少",
		quietDek:        "市場平靜的一天",
		quietBody:       "昨日全平台轉為訊號的內容不多，沒有形成明顯的主題或標的熱點。安靜也是一種資訊——不必為沒有行情而焦慮。",
		headline:        "昨日市場關注",
		dek:             "來自全平台訊號的去識別化綜述",
		overviewHeading: "今日概覽",
		overviewIntro:   "昨日全平台共收錄 %d 條訊號。",
		themeJoin:       "最受關注的主題：",
		listSep:         "、",
		assetsHeading:   "標的觀察",
		signalsLabel:    "訊號",
		assetLineFmt:    "%s（%s %d）",
	},
	"en": {
		quietHeadline:   "A Quiet Day",
		quietDek:        "Markets were calm",
		quietBody:       "Few signals were promoted across the platform yesterday, with no clear themes or names standing out. Quiet is information too — no need to chase a day without a story.",
		headline:        "Yesterday in Focus",
		dek:             "A de-identified digest from platform-wide signals",
		overviewHeading: "Overview",
		overviewIntro:   "%d signals were logged platform-wide yesterday.",
		themeJoin:       " Most-discussed themes: ",
		listSep:         ", ",
		assetsHeading:   "On the Tape",
		signalsLabel:    "signals",
		assetLineFmt:    "%s (%s %d)",
	},
}
