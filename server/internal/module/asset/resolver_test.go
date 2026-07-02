package asset

import (
	"testing"

	"alphax/server/internal/infra/mastra"
)

func TestClassifyByRule_codes(t *testing.T) {
	cases := []struct {
		in        string
		market    string
		canonical string
		exchange  string
		provider  string
		name      string
	}{
		// A股: 带后缀
		{"300604.SZ", MarketA, "300604", "SZSE", "300604.SZ", "300604"},
		{"688019.SH", MarketA, "688019", "SSE", "688019.SH", "688019"},
		{"688120.SH", MarketA, "688120", "SSE", "688120.SH", "688120"},
		// A股: 裸 6 位 (首位定交易所)
		{"600584", MarketA, "600584", "SSE", "600584.SH", "600584"},
		{"002371", MarketA, "002371", "SZSE", "002371.SZ", "002371"},
		{"300054", MarketA, "300054", "SZSE", "300054.SZ", "300054"},
		{"830799", MarketA, "830799", "BSE", "830799.BJ", "830799"}, // 8 → 北交所
		{"430139", MarketA, "430139", "BSE", "430139.BJ", "430139"}, // 4 → 北交所
		{"900901", MarketA, "900901", "SSE", "900901.SH", "900901"}, // 9 → 沪 B股
		// 港股: 带后缀 / 裸 4-5 位 (补零到 5)
		{"9992.HK", MarketHK, "09992", "HKEX", "09992.HK", "09992"},
		{"0700", MarketHK, "00700", "HKEX", "00700.HK", "00700"},
		{"09988", MarketHK, "09988", "HKEX", "09988.HK", "09988"},
		// 括号内嵌代码: name 取括号前
		{"泡泡玛特 (9992.HK)", MarketHK, "09992", "HKEX", "09992.HK", "泡泡玛特"},
		{"安集科技 (688019.SH)", MarketA, "688019", "SSE", "688019.SH", "安集科技"},
		{"鼎龙股份 (300054.SZ)", MarketA, "300054", "SZSE", "300054.SZ", "鼎龙股份"},
	}
	for _, c := range cases {
		t.Run(c.in, func(t *testing.T) {
			r := classifyByRule(c.in)
			if r == nil {
				t.Fatalf("classifyByRule(%q) = nil, want resolution", c.in)
			}
			if r.Market != c.market || r.Canonical != c.canonical ||
				r.Exchange != c.exchange || r.ProviderSymbol != c.provider || r.Name != c.name {
				t.Errorf("classifyByRule(%q) = {market=%s canonical=%s exchange=%s provider=%s name=%s}, want {market=%s canonical=%s exchange=%s provider=%s name=%s}",
					c.in, r.Market, r.Canonical, r.Exchange, r.ProviderSymbol, r.Name,
					c.market, c.canonical, c.exchange, c.provider, c.name)
			}
			if r.Status != StatusActive {
				t.Errorf("classifyByRule(%q) status=%s, want active", c.in, r.Status)
			}
		})
	}
}

func TestClassifyByRule_defersLettersAndNames(t *testing.T) {
	// 裸字母美股 ticker、公司名、模糊板块: 规则层不猜, 交给 LLM (返回 nil).
	// (头部加密如 BTC/ETH 现由 classifyCrypto 规则命中, 已挪到 TestClassifyCrypto.)
	defer_ := []string{
		"NVDA", "MSFT", "AMD", "TSM", // 美股 ticker
		"宁德时代", "北方华创", "英伟达", // 中文名
		"FOOBARCOIN", "SCAMTOKEN", // 长尾/山寨加密 (不在白名单) → defer
		"Strategy (MSTR)", "中芯国际 (SMIC)", "港交所 (HKEX)", "黄金 (GLD/IAU)", // 括号内非数字代码
		"国内存储模组厂", "云厂 (MSFT/GOOGL/AMZN)", "AI应用层公司", // 模糊板块/篮子
		"DeepSeek (未上市)", "OpenAI (未上市)", // 未上市
		"", "   ",
	}
	for _, in := range defer_ {
		if r := classifyByRule(in); r != nil {
			t.Errorf("classifyByRule(%q) = %+v, want nil (defer to LLM)", in, r)
		}
	}
}

func TestClassifyCrypto(t *testing.T) {
	cases := []struct {
		in        string
		canonical string
		typ       string
	}{
		{"BTC", "BTC", "crypto"},
		{"比特币", "BTC", "crypto"},
		{"bitcoin", "BTC", "crypto"},
		{"以太坊", "ETH", "crypto"},
		{" ETH ", "ETH", "crypto"},
		{"索拉纳", "SOL", "crypto"},
		{"HYPE", "HYPE", "crypto"},
		{"泰达币", "USDT", "stablecoin"}, // 稳定币 type
		{"usdc", "USDC", "stablecoin"},
		{"狗狗币", "DOGE", "crypto"},
	}
	for _, c := range cases {
		r := classifyCrypto(c.in)
		if r == nil {
			t.Errorf("classifyCrypto(%q) = nil, want %s", c.in, c.canonical)
			continue
		}
		if r.Market != MarketCrypto || r.Canonical != c.canonical || r.Type != c.typ ||
			r.ProviderSymbol != c.canonical+"-USDT" || r.Status != StatusActive || r.Exchange != "" {
			t.Errorf("classifyCrypto(%q) = %+v", c.in, r)
		}
	}
	// 长尾/山寨/非币: 白名单不命中 → nil (交给 LLM, 但 LLM 也会被白名单复核挡下).
	for _, in := range []string{"FOOBARCOIN", "SCAMTOKEN", "宁德时代", ""} {
		if r := classifyCrypto(in); r != nil {
			t.Errorf("classifyCrypto(%q) = %+v, want nil", in, r)
		}
	}
	// 走完整规则入口也应命中 (classifyByRule 内含 classifyCrypto).
	if r := classifyByRule("比特币"); r == nil || r.Canonical != "BTC" {
		t.Errorf("classifyByRule(比特币) = %+v, want BTC", r)
	}
}

func TestNormalizeAlias(t *testing.T) {
	cases := map[string]string{
		"  NVDA ":           "nvda",
		"宁德时代":              "宁德时代",
		"SK Hynix":          "sk hynix",
		"A   B":             "a b",
		"NvDa":              "nvda",
		"  泡泡玛特 (9992.HK) ": "泡泡玛特 (9992.hk)",
	}
	for in, want := range cases {
		if got := normalizeAlias(in); got != want {
			t.Errorf("normalizeAlias(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestResolutionFromLLM(t *testing.T) {
	t.Run("not resolvable → nil", func(t *testing.T) {
		if r := resolutionFromLLM(&mastra.SymbolResolveResponse{Resolvable: false, Reason: "加密货币"}); r != nil {
			t.Errorf("got %+v, want nil", r)
		}
	})
	t.Run("nil response → nil", func(t *testing.T) {
		if r := resolutionFromLLM(nil); r != nil {
			t.Errorf("got %+v, want nil", r)
		}
	})

	ok := []struct {
		resp      mastra.SymbolResolveResponse
		market    string
		canonical string
		exchange  string
	}{
		{mastra.SymbolResolveResponse{Resolvable: true, Market: "a", Symbol: "300750", Name: "宁德时代"}, MarketA, "300750", "SZSE"},
		{mastra.SymbolResolveResponse{Resolvable: true, Market: "us", Symbol: "nvda", Name: "NVIDIA", Exchange: "NASDAQ"}, MarketUS, "NVDA", "NASDAQ"},
		{mastra.SymbolResolveResponse{Resolvable: true, Market: "hk", Symbol: "700", Name: "腾讯"}, MarketHK, "00700", "HKEX"},
		// 美股交易所留空 (拿不准不谎报)
		{mastra.SymbolResolveResponse{Resolvable: true, Market: "us", Symbol: "MSTR"}, MarketUS, "MSTR", ""},
		// 加密: 白名单内 ticker 接受 (交易所恒空)
		{mastra.SymbolResolveResponse{Resolvable: true, Market: "crypto", Symbol: "btc", Name: "Bitcoin", Type: "crypto"}, MarketCrypto, "BTC", ""},
		{mastra.SymbolResolveResponse{Resolvable: true, Market: "crypto", Symbol: "SOL"}, MarketCrypto, "SOL", ""},
	}
	for _, c := range ok {
		r := resolutionFromLLM(&c.resp)
		if r == nil {
			t.Fatalf("resolutionFromLLM(%+v) = nil, want resolution", c.resp)
		}
		if r.Market != c.market || r.Canonical != c.canonical || r.Exchange != c.exchange {
			t.Errorf("resolutionFromLLM(%+v) = {market=%s canonical=%s exchange=%s}, want {%s %s %s}",
				c.resp, r.Market, r.Canonical, r.Exchange, c.market, c.canonical, c.exchange)
		}
		if r.Source != "llm" {
			t.Errorf("source = %s, want llm", r.Source)
		}
	}

	// 结构校验: 代码格式与 market 不符 → nil (兜住格式型幻觉)
	bad := []mastra.SymbolResolveResponse{
		{Resolvable: true, Market: "a", Symbol: "NVDA"},          // A股须 6 位数字
		{Resolvable: true, Market: "us", Symbol: "123456"},       // 美股须字母
		{Resolvable: true, Market: "kr", Symbol: "005930"},       // market 非 a|hk|us|crypto
		{Resolvable: true, Market: "a", Symbol: ""},              // 空代码
		{Resolvable: true, Market: "crypto", Symbol: "FOOBAR"},   // 加密: 不在白名单 → fail-closed
		{Resolvable: true, Market: "crypto", Symbol: "btc-usdt"}, // 结构不符 (含连字符/小写以外字符)
	}
	for _, resp := range bad {
		if r := resolutionFromLLM(&resp); r != nil {
			t.Errorf("resolutionFromLLM(%+v) = %+v, want nil (structural reject)", resp, r)
		}
	}
}

func TestUntrackableRes(t *testing.T) {
	r := untrackableRes("国内存储模组厂", "行业篮子", "llm")
	if r.Status != StatusUntrackable || r.Market != MarketOther {
		t.Errorf("untrackable: status=%s market=%s, want untrackable/other", r.Status, r.Market)
	}
	if r.Canonical != "国内存储模组厂" || r.Name != "国内存储模组厂" {
		t.Errorf("untrackable: canonical=%q name=%q", r.Canonical, r.Name)
	}
	if r.Reason != "行业篮子" {
		t.Errorf("untrackable reason=%q, want 行业篮子", r.Reason)
	}
}

func TestManualResolution(t *testing.T) {
	t.Run("valid A-share", func(t *testing.T) {
		r, err := manualResolution("a", "300750", "", "宁德时代")
		if err != nil {
			t.Fatal(err)
		}
		if r.Market != MarketA || r.Canonical != "300750" || r.Exchange != "SZSE" || r.Name != "宁德时代" || r.Source != "manual" {
			t.Errorf("got %+v", r)
		}
	})
	t.Run("valid US lowercases", func(t *testing.T) {
		r, err := manualResolution("us", "nvda", "nasdaq", "")
		if err != nil {
			t.Fatal(err)
		}
		if r.Canonical != "NVDA" || r.Exchange != "NASDAQ" {
			t.Errorf("got %+v", r)
		}
	})
	t.Run("HK pads zero", func(t *testing.T) {
		r, err := manualResolution("hk", "700", "", "腾讯")
		if err != nil {
			t.Fatal(err)
		}
		if r.Canonical != "00700" {
			t.Errorf("canonical=%q, want 00700", r.Canonical)
		}
	})
	t.Run("crypto uppercases + provider pair", func(t *testing.T) {
		// 人工兜底不受白名单约束 (运营可强制冷门币), 只做结构校验.
		r, err := manualResolution("crypto", "hype", "", "Hyperliquid")
		if err != nil {
			t.Fatal(err)
		}
		if r.Market != MarketCrypto || r.Canonical != "HYPE" || r.ProviderSymbol != "HYPE-USDT" || r.Name != "Hyperliquid" {
			t.Errorf("got %+v", r)
		}
	})

	errCases := []struct {
		market, canonical string
		want              error
	}{
		{"a", "abc", ErrInvalidCode},
		{"us", "1234", ErrInvalidCode},
		{"", "300750", ErrMissingFields},
		{"kr", "005930", ErrInvalidMarket},
		{"a", "", ErrMissingFields},
		{"crypto", "x", ErrInvalidCode},   // 单字符不满足 crypto ticker 结构 (2-15)
		{"crypto", "b/c", ErrInvalidCode}, // 含非法字符
	}
	for _, c := range errCases {
		_, err := manualResolution(c.market, c.canonical, "", "")
		if err != c.want {
			t.Errorf("manualResolution(%q,%q) err = %v, want %v", c.market, c.canonical, err, c.want)
		}
	}
}
