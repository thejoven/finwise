package recommend

import (
	"math"
	"testing"
	"time"

	"github.com/google/uuid"
)

// TestPromoteClientEventIDContract 钉死与 subscription/service.go Promote 的确定性键公式.
// 它是 category_affinity 反推被转推文的唯一桥; 任一边改了公式, 这里就该红.
func TestPromoteClientEventIDContract(t *testing.T) {
	u := uuid.MustParse("11111111-1111-1111-1111-111111111111")
	const tweetID = "1798000000000000001"

	// 同 subscription 测试里的派生方式 (verbatim formula).
	want := uuid.NewSHA1(uuid.NameSpaceOID, []byte("tweet-promote:"+u.String()+":"+tweetID))
	got := promoteClientEventID(u, tweetID)
	if got != want {
		t.Fatalf("client_event_id 公式漂移: got %s want %s", got, want)
	}
	// 确定性: 同输入恒等.
	if promoteClientEventID(u, tweetID) != got {
		t.Fatal("promoteClientEventID 非确定性")
	}
	// 不同 tweet → 不同 id.
	if promoteClientEventID(u, "1798000000000000002") == got {
		t.Fatal("不同 tweet 却得同一 client_event_id")
	}
}

func TestFunnelWeight(t *testing.T) {
	cases := []struct {
		name string
		row  SignalTagRow
		want float64
	}{
		{"done only", SignalTagRow{}, 1},
		{"refined", SignalTagRow{Refined: true}, 2},
		{"passed gate", SignalTagRow{Refined: true, PassedGate: true}, 3},
		{"committed", SignalTagRow{Refined: true, PassedGate: true, Committed: true}, 4},
	}
	for _, c := range cases {
		if got := funnelWeight(c.row); got != c.want {
			t.Errorf("%s: funnelWeight = %v want %v", c.name, got, c.want)
		}
	}
}

func TestTagAffinityNormalization(t *testing.T) {
	rows := []SignalTagRow{
		{Tags: []string{"AI芯片"}, Refined: true, PassedGate: true, Committed: true}, // weight 4
		{Tags: []string{"AI芯片", "美债"}},                                             // weight 1 each
		{Tags: []string{"美债"}, Refined: true},                                      // weight 2
		{Tags: []string{""}},                                                       // 空标签忽略
	}
	got := tagAffinity(rows)
	// AI芯片: 4+1 = 5 (max) → 1.0; 美债: 1+2 = 3 → 0.6
	if !approx(got["AI芯片"], 1.0) {
		t.Errorf("AI芯片 affinity = %v want 1.0", got["AI芯片"])
	}
	if !approx(got["美债"], 0.6) {
		t.Errorf("美债 affinity = %v want 0.6", got["美债"])
	}
	if _, ok := got[""]; ok {
		t.Error("空标签不应进入 affinity")
	}
}

func TestCategoryAffinity(t *testing.T) {
	got := categoryAffinity([]string{"公司", "公司", "宏观", "", "公司", "宏观"})
	if !approx(got["公司"], 1.0) { // 3 (max)
		t.Errorf("公司 = %v want 1.0", got["公司"])
	}
	if !approx(got["宏观"], 0.667) { // 2/3
		t.Errorf("宏观 = %v want 0.667", got["宏观"])
	}
	if len(categoryAffinity(nil)) != 0 {
		t.Error("nil categories 应得空图")
	}
}

func TestConvictionShape(t *testing.T) {
	g2, g3 := 2, 3
	outcomes := []GateOutcome{
		{Passed: true},
		{Passed: true},
		{Passed: false, FailedGate: &g3},
		{Passed: false, FailedGate: &g3},
		{Passed: false, FailedGate: &g2},
	}
	cs := convictionShape(outcomes)
	if cs.EvaluationsTotal != 5 || cs.Passed != 2 || cs.Failed != 3 {
		t.Errorf("counts off: %+v", cs)
	}
	if !approx(cs.PassRate, 0.4) {
		t.Errorf("pass_rate = %v want 0.4", cs.PassRate)
	}
	if cs.FailedGateHistogram["3"] != 2 || cs.FailedGateHistogram["2"] != 1 {
		t.Errorf("histogram off: %+v", cs.FailedGateHistogram)
	}
	if cs.TypicalFailedGate == nil || *cs.TypicalFailedGate != 3 {
		t.Errorf("typical failed gate = %v want 3", cs.TypicalFailedGate)
	}

	// 全通过 → 无典型失败门.
	allPass := convictionShape([]GateOutcome{{Passed: true}})
	if allPass.TypicalFailedGate != nil {
		t.Errorf("全通过不应有 typical failed gate, got %v", *allPass.TypicalFailedGate)
	}
	if allPass.Failed != 0 || !approx(allPass.PassRate, 1.0) {
		t.Errorf("全通过统计错: %+v", allPass)
	}

	// 空 → 全零, pass_rate 0, 无众数.
	empty := convictionShape(nil)
	if empty.EvaluationsTotal != 0 || empty.PassRate != 0 || empty.TypicalFailedGate != nil {
		t.Errorf("空评估应全零: %+v", empty)
	}
}

func TestConvictionTypicalGateTieBreak(t *testing.T) {
	g1, g4 := 1, 4
	// g1 与 g4 各 1 次, 平票 → 取门号小者 (1).
	cs := convictionShape([]GateOutcome{
		{Passed: false, FailedGate: &g4},
		{Passed: false, FailedGate: &g1},
	})
	if cs.TypicalFailedGate == nil || *cs.TypicalFailedGate != 1 {
		t.Errorf("平票应取门号最小 (1), got %v", cs.TypicalFailedGate)
	}
}

func TestWeaknesses(t *testing.T) {
	now := time.Now()
	// 新→旧 传入 (repo 保证). 决策速度 2 次, 推演深度 1 次 → 主导 = 决策速度.
	rows := []WeaknessEntry{
		{Dim: "决策速度", Text: "下手太慢", At: now},
		{Dim: "推演深度", Text: "只看一层", At: now.Add(-time.Hour)},
		{Dim: "决策速度", Text: "犹豫", At: now.Add(-2 * time.Hour)},
	}
	w := weaknesses(rows, 5)
	if w.DimCounts["决策速度"] != 2 || w.DimCounts["推演深度"] != 1 {
		t.Errorf("dim counts off: %+v", w.DimCounts)
	}
	if w.DominantDim != "决策速度" {
		t.Errorf("dominant = %q want 决策速度", w.DominantDim)
	}
	if len(w.Recent) != 3 {
		t.Errorf("recent len = %d want 3", len(w.Recent))
	}

	// recent 截断到 N, 取最近的.
	wCap := weaknesses(rows, 2)
	if len(wCap.Recent) != 2 || wCap.Recent[0].Dim != "决策速度" || wCap.Recent[0].Text != "下手太慢" {
		t.Errorf("recent cap 错: %+v", wCap.Recent)
	}

	// 空输入.
	wEmpty := weaknesses(nil, 5)
	if wEmpty.DominantDim != "" || len(wEmpty.Recent) != 0 || len(wEmpty.DimCounts) != 0 {
		t.Errorf("空复盘应得空 weaknesses: %+v", wEmpty)
	}
}

func TestWeaknessDominantTieFavorsRecent(t *testing.T) {
	now := time.Now()
	// A、B 各 1 次, 平票. A 更近 (排在前) → 主导取 A.
	rows := []WeaknessEntry{
		{Dim: "持仓耐心", At: now},
		{Dim: "录入速度", At: now.Add(-time.Hour)},
	}
	if got := weaknesses(rows, 5).DominantDim; got != "持仓耐心" {
		t.Errorf("平票应取更近的 dim (持仓耐心), got %q", got)
	}
}

func TestNormalizeEmpty(t *testing.T) {
	if len(normalize(nil)) != 0 {
		t.Error("normalize(nil) 应空")
	}
	if len(normalize(map[string]float64{"x": 0})) != 0 {
		t.Error("全 0 应归一为空图")
	}
}

func approx(a, b float64) bool { return math.Abs(a-b) < 1e-9 }
