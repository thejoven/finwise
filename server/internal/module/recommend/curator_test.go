package recommend

import (
	"testing"
	"time"
)

func TestAssetTerms(t *testing.T) {
	got := assetTerms(CommitmentTarget{Asset: " NVDA ", AssetName: "NVIDIA"})
	if len(got) != 2 || got[0] != "NVDA" || got[1] != "NVIDIA" {
		t.Errorf("assetTerms = %v want [NVDA NVIDIA]", got)
	}
	if g := assetTerms(CommitmentTarget{Asset: "X", AssetName: "X"}); len(g) != 1 {
		t.Errorf("去重失败: %v", g)
	}
	if g := assetTerms(CommitmentTarget{Asset: "  ", AssetName: ""}); len(g) != 0 {
		t.Errorf("全空应得 0 项: %v", g)
	}
}

func TestRecencyFactor(t *testing.T) {
	if f := recencyFactor(0, 14); f != 1 {
		t.Errorf("age0 = %v want 1", f)
	}
	if f := recencyFactor(7, 14); !approx(f, 0.5) {
		t.Errorf("mid = %v want 0.5", f)
	}
	if f := recencyFactor(100, 14); f != 0.1 {
		t.Errorf("very old 应触底 0.1, got %v", f)
	}
	if f := recencyFactor(5, 0); f != 1 {
		t.Errorf("windowDays=0 → 1, got %v", f)
	}
}

func TestMaxAffinity(t *testing.T) {
	aff := map[string]float64{"AI芯片": 0.8, "美债": 0.3}
	if m := maxAffinity([]string{"美债", "AI芯片"}, aff); !approx(m, 0.8) {
		t.Errorf("max = %v want 0.8", m)
	}
	if m := maxAffinity([]string{"无关"}, aff); m != 0 {
		t.Errorf("无命中 = %v want 0", m)
	}
	if m := maxAffinity(nil, aff); m != 0 {
		t.Errorf("nil tags = %v want 0", m)
	}
}

func TestRankCandidates(t *testing.T) {
	now := time.Date(2026, 6, 16, 0, 0, 0, 0, time.UTC)
	aff := map[string]float64{"AI芯片": 1.0}
	cands := []CandidateTweet{
		{ID: "a", Relevance: 0.9, CreatedAt: now.Add(-13 * 24 * time.Hour)}, // 高 relevance 但旧、无亲和
		{ID: "b", Relevance: 0.6, CreatedAt: now, Tags: []string{"AI芯片"}},   // 中 relevance 但新、满亲和
		{ID: "c", Relevance: 0.5, CreatedAt: now.Add(-1 * 24 * time.Hour)},  // 中 relevance、较新、无亲和
	}
	ranked := rankCandidates(cands, aff, 14, now)
	if len(ranked) != 3 {
		t.Fatalf("len = %d want 3", len(ranked))
	}
	// b ≈ 0.6×1×2 = 1.2; c ≈ 0.5×0.929×1 ≈ 0.464; a ≈ 0.9×0.1(触底)×1 = 0.09 → b>c>a.
	if ranked[0].tweet.ID != "b" {
		t.Errorf("榜首应为 b(新+亲和), got %s", ranked[0].tweet.ID)
	}
	if ranked[2].tweet.ID != "a" {
		t.Errorf("垫底应为 a(旧+无亲和), got %s", ranked[2].tweet.ID)
	}
	// 降序单调.
	if !(ranked[0].score >= ranked[1].score && ranked[1].score >= ranked[2].score) {
		t.Errorf("score 非降序: %v %v %v", ranked[0].score, ranked[1].score, ranked[2].score)
	}
}

func TestRationaleForCommitment(t *testing.T) {
	if r := rationaleForCommitment(CommitmentTarget{Asset: "NVDA"}); r != "与你持仓「NVDA」相关的新进展" {
		t.Errorf("rationale = %q", r)
	}
	if r := rationaleForCommitment(CommitmentTarget{AssetName: "英伟达"}); r != "与你持仓「英伟达」相关的新进展" {
		t.Errorf("rationale(name) = %q", r)
	}
	if r := rationaleForCommitment(CommitmentTarget{}); r != "与你的一条在持命题相关的新进展" {
		t.Errorf("rationale(empty) = %q", r)
	}
}
