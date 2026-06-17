package recommend

import (
	"context"
	"fmt"
	"math"

	"github.com/google/uuid"
)

// recentWeaknessN — self_known_weaknesses.recent 里保留的最近条数.
const recentWeaknessN = 5

// promoteClientEventID 复刻 subscription/service.go Promote 的确定性幂等键派生.
//
// ⚠️ 契约: 此公式必须与 subscription 完全一致 —— 它是 category_affinity 反推"被转信号的推文"
// 的唯一桥 (转信号链路无 from_tweet_id 列). 由 TestPromoteClientEventIDContract 钉死;
// subscription 侧另有 TestPromoteIdempotencyKeyDerivation 钉同一公式. 任何一边改了, 单测会红.
func promoteClientEventID(userID uuid.UUID, tweetID string) uuid.UUID {
	return uuid.NewSHA1(uuid.NameSpaceOID, []byte("tweet-promote:"+userID.String()+":"+tweetID))
}

// Builder 从既有行为轨迹派生一个用户的 alpha 画像. 无状态, 持有 repo.
type Builder struct {
	repo *Repository
}

func NewBuilder(repo *Repository) *Builder {
	return &Builder{repo: repo}
}

// BuildProfile 读齐各行为源并组装画像 (不落库 —— 落库由 service.RebuildUser 负责).
func (b *Builder) BuildProfile(ctx context.Context, userID uuid.UUID) (*Profile, error) {
	signalRows, err := b.repo.SignalTagRows(ctx, userID)
	if err != nil {
		return nil, err
	}
	gateOutcomes, err := b.repo.GateOutcomes(ctx, userID)
	if err != nil {
		return nil, err
	}
	theses, err := b.repo.ActiveTheses(ctx, userID)
	if err != nil {
		return nil, err
	}
	weaknessRows, err := b.repo.WeaknessRows(ctx, userID)
	if err != nil {
		return nil, err
	}
	categories, err := b.repo.PromotedCategories(ctx, userID)
	if err != nil {
		return nil, err
	}
	highWater, err := b.repo.BehaviorHighWater(ctx, userID)
	if err != nil {
		return nil, err
	}

	return &Profile{
		UserID:           userID,
		TagAffinity:      tagAffinity(signalRows),
		CategoryAffinity: categoryAffinity(categories),
		Conviction:       convictionShape(gateOutcomes),
		Weaknesses:       weaknesses(weaknessRows, recentWeaknessN),
		ActiveTheses:     theses,
		BuiltFromUntil:   highWater,
		SampleSize:       len(signalRows), // done signals = 画像的标签基底
	}, nil
}

// ───────────────────────── 纯派生函数 (可单测, 不碰 DB) ─────────────────────────

// funnelWeight — 信号在漏斗里走得越深, 它的标签越能代表"用户真正下功夫的赛道".
//
//	done            → 1
//	+ 完成五轮       → 2
//	+ 四道门全过     → 3
//	+ 签下承诺       → 4
//
// 各级累加 (走到签字 = 4), 不是互斥取一.
func funnelWeight(row SignalTagRow) float64 {
	w := 1.0
	if row.Refined {
		w++
	}
	if row.PassedGate {
		w++
	}
	if row.Committed {
		w++
	}
	return w
}

// tagAffinity 按漏斗深度加权聚合 signals.inference_tags, 再归一化到 0..1 (最强赛道 = 1.0).
// 注: 被"转信号"的推文已经成为带 inference_tags 的 signal, 故其内容天然计入此处 —— 不再
// 单独叠加 tweet.tags, 避免双计 (见 §2 数据来源辨析).
func tagAffinity(rows []SignalTagRow) map[string]float64 {
	weighted := map[string]float64{}
	for _, row := range rows {
		w := funnelWeight(row)
		for _, tag := range row.Tags {
			if tag == "" {
				continue
			}
			weighted[tag] += w
		}
	}
	return normalize(weighted)
}

// categoryAffinity 统计被转信号推文的 category 频次, 归一化到 0..1.
func categoryAffinity(categories []string) map[string]float64 {
	weighted := map[string]float64{}
	for _, c := range categories {
		if c == "" {
			continue
		}
		weighted[c]++
	}
	return normalize(weighted)
}

// normalize 把权重图按最大值归一到 0..1, 保留 3 位小数. 空图 / 全 0 → 空图.
func normalize(weighted map[string]float64) map[string]float64 {
	max := 0.0
	for _, w := range weighted {
		if w > max {
			max = w
		}
	}
	if max == 0 {
		return map[string]float64{}
	}
	out := make(map[string]float64, len(weighted))
	for k, w := range weighted {
		out[k] = round(w/max, 3)
	}
	return out
}

// convictionShape 统计四道门通过/否决 + 典型失败门 (众数, 平票取门号小者).
func convictionShape(outcomes []GateOutcome) ConvictionShape {
	cs := ConvictionShape{FailedGateHistogram: map[string]int{}}
	cs.EvaluationsTotal = len(outcomes)
	for _, o := range outcomes {
		if o.Passed {
			cs.Passed++
			continue
		}
		cs.Failed++
		if o.FailedGate != nil && *o.FailedGate >= 1 && *o.FailedGate <= 4 {
			cs.FailedGateHistogram[fmt.Sprintf("%d", *o.FailedGate)]++
		}
	}
	if cs.EvaluationsTotal > 0 {
		cs.PassRate = round(float64(cs.Passed)/float64(cs.EvaluationsTotal), 2)
	}
	// 典型失败门: 直方图众数, 平票取门号最小 (确定性).
	bestGate, bestCount := 0, 0
	for gate := 1; gate <= 4; gate++ {
		if c := cs.FailedGateHistogram[fmt.Sprintf("%d", gate)]; c > bestCount {
			bestCount, bestGate = c, gate
		}
	}
	if bestGate > 0 {
		g := bestGate
		cs.TypicalFailedGate = &g
	}
	return cs
}

// weaknesses 聚合复盘训练重点: dim 频次 + 主导 dim (众数, 平票取更近的一条) + 最近 N 条.
// rows 必须按时间新→旧传入 (repo.WeaknessRows 已保证).
func weaknesses(rows []WeaknessEntry, recentN int) Weaknesses {
	w := Weaknesses{DimCounts: map[string]int{}, Recent: []WeaknessEntry{}}
	for _, r := range rows {
		if r.Dim != "" {
			w.DimCounts[r.Dim]++
		}
	}
	// 主导 dim: 频次最高者; 平票时因 rows 是新→旧, 先扫到的更近, 用 > 保证先到者胜 = 取更近.
	bestCount := 0
	for _, r := range rows {
		if r.Dim == "" {
			continue
		}
		if c := w.DimCounts[r.Dim]; c > bestCount {
			bestCount = c
			w.DominantDim = r.Dim
		}
	}
	if recentN > 0 && len(rows) > recentN {
		w.Recent = append(w.Recent, rows[:recentN]...)
	} else {
		w.Recent = append(w.Recent, rows...)
	}
	return w
}

// round 把 x 保留到 prec 位小数.
func round(x float64, prec int) float64 {
	p := math.Pow10(prec)
	return math.Round(x*p) / p
}
